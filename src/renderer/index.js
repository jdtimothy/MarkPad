import './styles.css';
import 'katex/dist/katex.min.css';
import { createEditor, getDoc, setDoc } from './editor.js';
import { initUI, registerFileActions } from './ui.js';
import { createFrontmatterPanel } from './fmpanel.js';
import { splitFrontmatter, joinDoc } from './frontmatter.js';
import { createGitHubPanel } from './github-panel.js';
import { createSources } from './doc-source.js';
import { createCommitBar } from './commit-bar.js';

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

  let options = {};
  if (source.kind === 'repo') {
    const message = await commitBar.ask(`Update ${source.path}`);
    if (message === null) return false; // cancelled
    options = { message };
  }

  const wasRepo = source.kind === 'repo';
  const result = await source.save(fullDoc(), options);
  if (!result.ok) {
    ui.showError(`Could not save: ${result.error}`);
    return false;
  }
  markSaved(result.source, currentName);
  if (wasRepo) ghPanel.reloadTree();
  return true;
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
