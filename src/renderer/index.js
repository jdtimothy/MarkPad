import './styles.css';
import 'katex/dist/katex.min.css';
import { createEditor, getDoc, setDoc } from './editor.js';
import { initUI, registerFileActions } from './ui.js';
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

const ghPanel = createGitHubPanel(document.getElementById('gh-sidebar'), {
  onError: (msg) => ui.showError(msg),
  onOpenFile: openRepoFile,
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
  fmPanel.setFrontmatter(null);
  setDoc(view, '');
  await ui.refreshRendered();
  markSaved(null, 'untitled.md');
}

async function openFile() {
  if (!(await guardDirty())) return;
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

  // Stale-file guard: has this exact file moved since we opened it?
  const current = await window.markpad.github.fileSha(source.repo, source.branch, source.path);
  const stale = current.ok && current.data.sha && current.data.sha !== source.baseSha;

  let result = stale
    ? { ok: false, conflict: true, error: 'File changed on GitHub' }
    : await source.save(fullDoc(), { message });

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
    result = await source.save(fullDoc(), { message, force: true });
  }

  if (!result.ok) {
    ui.showError(`Could not commit: ${result.error}`);
    return false;
  }
  markSaved(result.source, currentName);
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
