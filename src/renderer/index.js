import './styles.css';
import 'katex/dist/katex.min.css';
import { createEditor, getDoc, setDoc } from './editor.js';
import { initUI, registerFileActions, setImageHandler } from './ui.js';
import { setAssetResolver } from './preview.js';
import { imageLink, repoPathForLink, uniquePath } from './github-paths.js';
import { createFrontmatterPanel } from './fmpanel.js';
import { splitFrontmatter, joinDoc } from './frontmatter.js';
import { createGitHubPanel } from './github-panel.js';
import { createSources } from './doc-source.js';
import { createCommitBar, askConflict } from './commit-bar.js';

const sources = createSources(window.markpad);
const commitBar = createCommitBar();

let ui;
let fmPanel;
let source = null; // null = a new unsaved buffer
let currentName = 'untitled.md';
// Images chosen for a repo document wait here until the next commit.
let pendingImages = []; // [{ path, base64, dataUrl }]
let savedDoc = '';
const titlebarFile = document.getElementById('titlebar-file');
const maximizeButton = document.getElementById('window-maximize');

const view = createEditor(document.getElementById('editor-pane'), () => {
  if (!ui) return;
  ui.updateStatus();
  refreshTitle();
});
ui = initUI(view, () => refreshTitle());
fmPanel = createFrontmatterPanel(document.getElementById('fm-panel'), () =>
  refreshTitle()
);
async function openRepoFile({ repo, branch, path, sha, headSha, content }) {
  if (!(await guardDirty())) return;
  pendingImages = [];
  const normalized = content.replace(/\r\n/g, '\n');
  const { fm, body } = splitFrontmatter(normalized);
  fmPanel.setFrontmatter(fm);
  setDoc(view, body);
  await ui.refreshRendered();
  markSaved(
    sources.repoSource({ repo, branch, path, baseSha: sha, headSha }),
    path.split('/').pop()
  );
}

async function newRepoFile({ repo, branch, path }) {
  if (!(await guardDirty())) return;
  pendingImages = [];
  const head = await window.markpad.github.getHead(repo, branch);
  if (!head.ok) {
    ui.showError(`Could not start a new post: ${head.error}`);
    return;
  }
  fmPanel.setFrontmatter(null);
  setDoc(view, '');
  await ui.refreshRendered();
  // baseSha null means "this file does not exist on GitHub yet", so the
  // stale-file guard in save() correctly skips the conflict check.
  markSaved(
    sources.repoSource({ repo, branch, path, baseSha: null, headSha: head.data.headSha }),
    path.split('/').pop()
  );
  savedDoc = null; // a brand-new post starts dirty so Ctrl+S has something to do
  refreshTitle();
}

async function onRepoFileRenamed({ repo, branch, oldPath, newPath }) {
  if (source?.kind !== 'repo' || source.path !== oldPath) return;
  const head = await window.markpad.github.getHead(repo, branch);
  const file = await window.markpad.github.fileSha(repo, branch, newPath);
  currentName = newPath.split('/').pop();
  source = sources.repoSource({
    repo,
    branch,
    path: newPath,
    baseSha: file.ok ? file.data.sha : null,
    headSha: head.ok ? head.data.headSha : source.headSha,
  });
  refreshTitle();
}

async function onRepoFileDeleted({ repo, branch, path }) {
  if (source?.kind !== 'repo' || source.path !== path) return;
  // The buffer stays open but is no longer backed by anything on GitHub.
  source = null;
  currentName = `${path.split('/').pop()} (deleted)`;
  refreshTitle();
}

const ghPanel = createGitHubPanel(document.getElementById('gh-sidebar'), {
  onError: (msg) => ui.showError(msg),
  onOpenFile: openRepoFile,
  onNewFile: newRepoFile,
  onRenamed: onRepoFileRenamed,
  onDeleted: onRepoFileDeleted,
});
ghPanel.refreshAccount();

// The document on disk = frontmatter block (panel) + body (editor).
function fullDoc() {
  ui?.syncFromRendered();
  return joinDoc(fmPanel.getFrontmatter(), getDoc(view));
}

function isDirty() {
  return fullDoc() !== savedDoc;
}

function refreshTitle() {
  if (!ui || !fmPanel) return;
  const dirty = isDirty();
  ui.setStatusFile(currentName, dirty);
  if (titlebarFile) titlebarFile.textContent = dirty ? `${currentName} *` : currentName;
}

function markSaved(newSource, name) {
  source = newSource;
  currentName = name;
  savedDoc = fullDoc();
  refreshTitle();
}

// Returns true if it is safe to discard the current buffer.
async function guardDirty() {
  if (!isDirty()) return true;
  const choice = await window.markpad.confirmUnsaved();
  if (choice === 2) return false; // Cancel
  if (choice === 0) return save(); // Save; abort if the save fails/cancels
  return true; // Don't Save
}

async function newFile() {
  if (!(await guardDirty())) return;
  pendingImages = [];
  fmPanel.setFrontmatter(null);
  setDoc(view, '');
  await ui.refreshRendered();
  markSaved(null, 'untitled.md');
}

async function openFile() {
  if (!(await guardDirty())) return;
  pendingImages = [];
  const result = await window.markpad.openFile();
  if (!result) return;
  if (result.error) {
    ui.showError(`Could not open file: ${result.error}`);
    return;
  }
  const normalized = result.content.replace(/\r\n/g, '\n');
  const { fm, body } = splitFrontmatter(normalized);
  fmPanel.setFrontmatter(fm);
  setDoc(view, body);
  await ui.refreshRendered();
  markSaved(sources.localSource(result.path, result.name), result.name);
}

async function save() {
  if (!source) return saveAs();
  if (source.kind !== 'repo') {
    const result = await source.save(fullDoc());
    if (!result.ok) {
      ui.showError(`Could not save file: ${result.error}`);
      return false;
    }
    markSaved(result.source, currentName);
    return true;
  }

  const message = await commitBar.ask(`Update ${source.path}`);
  if (message === null) return false;

  const extraFiles = pendingImages.map((i) => ({ path: i.path, contentBase64: i.base64 }));

  // Stale-file guard: has this exact file moved since we opened it?
  const current = await window.markpad.github.fileSha(source.repo, source.branch, source.path);
  const stale = current.ok && current.data.sha && current.data.sha !== source.baseSha;

  let result = stale
    ? { ok: false, conflict: true, error: 'File changed on GitHub' }
    : await source.save(fullDoc(), { message, extraFiles });

  if (!result.ok && result.conflict) {
    const choice = await askConflict(
      `${source.path} changed on GitHub since you opened it.`
    );
    if (choice === 'cancel') return false;
    if (choice === 'browse') {
      window.markpad.github.openExternal(
        `https://github.com/${source.repo}/blob/${source.branch}/${source.path}`
      );
      return false;
    }
    if (choice === 'reload') {
      await reloadFromGitHub();
      return false;
    }
    result = await source.save(fullDoc(), { message, extraFiles, force: true });
  }

  if (!result.ok) {
    ui.showError(`Could not commit: ${result.error}`);
    return false;
  }
  markSaved(result.source, currentName);
  pendingImages = [];
  ghPanel.reloadTree();
  return true;
}

async function reloadFromGitHub() {
  const [file, head] = await Promise.all([
    window.markpad.github.readFile(source.repo, source.branch, source.path),
    window.markpad.github.getHead(source.repo, source.branch),
  ]);
  if (!file.ok || !head.ok) {
    ui.showError(`Could not reload: ${file.error || head.error}`);
    return;
  }
  const { fm, body } = splitFrontmatter(file.data.content.replace(/\r\n/g, '\n'));
  fmPanel.setFrontmatter(fm);
  setDoc(view, body);
  await ui.refreshRendered();
  markSaved(
    sources.repoSource({
      repo: source.repo,
      branch: source.branch,
      path: source.path,
      baseSha: file.data.sha,
      headSha: head.data.headSha,
    }),
    currentName
  );
}

async function saveAs() {
  const result = await window.markpad.saveFileAs(fullDoc());
  if (!result) return false; // cancelled
  if (!result.ok) {
    ui.showError(`Could not save file: ${result.error}`);
    return false;
  }
  markSaved(sources.localSource(result.path, result.name), result.name);
  return true;
}

setImageHandler(async () => {
  if (source?.kind !== 'repo') return null;
  const picked = await window.markpad.openImageData();
  if (!picked || picked.error) {
    if (picked?.error) ui.showError(`Could not read image: ${picked.error}`);
    return null;
  }
  const { imageDir, imageLinkStyle } = ghPanel.getConfig();
  const taken = [...ghPanel.getPaths(), ...pendingImages.map((i) => i.path)];
  const path = uniquePath(imageDir ? `${imageDir}/${picked.name}` : picked.name, taken);
  pendingImages.push({ path, base64: picked.base64, dataUrl: picked.dataUrl });
  return { url: imageLink(source.path, path, imageLinkStyle), name: picked.name };
});

setAssetResolver(async (src) => {
  if (source?.kind !== 'repo') return null;
  const known = [...ghPanel.getPaths(), ...pendingImages.map((i) => i.path)];
  const resolved = repoPathForLink(source.path, src, known);
  const staged = pendingImages.find((i) => i.path === resolved);
  if (staged) return staged.dataUrl;
  const asset = await window.markpad.github.readAsset(source.repo, source.branch, resolved);
  return asset.ok ? asset.data.dataUrl : null;
});

registerFileActions({ newFile, openFile, save, saveAs });

document.getElementById('window-minimize')?.addEventListener('click', () => {
  window.markpad.minimizeWindow();
});
maximizeButton?.addEventListener('click', () => {
  window.markpad.toggleMaximizeWindow();
});
document.getElementById('window-close')?.addEventListener('click', () => {
  window.markpad.closeWindow();
});
window.markpad.onWindowStateChanged?.(({ maximized }) => {
  if (!maximizeButton) return;
  maximizeButton.classList.toggle('restore', maximized);
  maximizeButton.title = maximized ? 'Restore' : 'Maximize';
  maximizeButton.setAttribute('aria-label', maximized ? 'Restore' : 'Maximize');
});

let closeGuardPending = false;
window.markpad.onCloseRequested(async () => {
  if (closeGuardPending) return;
  closeGuardPending = true;
  try {
    if (await guardDirty()) window.markpad.confirmClose();
  } finally {
    closeGuardPending = false;
  }
});

refreshTitle();
view.focus();
