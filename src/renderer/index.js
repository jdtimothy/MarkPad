import './styles.css';
import 'katex/dist/katex.min.css';
import { createEditor, getDoc, setDoc } from './editor.js';
import { initUI, registerFileActions } from './ui.js';
import { createFrontmatterPanel } from './fmpanel.js';
import { splitFrontmatter, joinDoc } from './frontmatter.js';

let ui;
let fmPanel;
let currentPath = null;
let currentName = 'untitled.md';
let savedDoc = '';

const view = createEditor(document.getElementById('editor-pane'), () => {
  if (!ui) return;
  ui.updateStatus();
  refreshTitle();
});
ui = initUI(view);
fmPanel = createFrontmatterPanel(document.getElementById('fm-panel'), () =>
  refreshTitle()
);

// The document on disk = frontmatter block (panel) + body (editor).
function fullDoc() {
  return joinDoc(fmPanel.getFrontmatter(), getDoc(view));
}

function isDirty() {
  return fullDoc() !== savedDoc;
}

function refreshTitle() {
  if (!ui || !fmPanel) return;
  ui.setStatusFile(currentName, isDirty());
}

function markSaved(pathOrNull, name) {
  currentPath = pathOrNull;
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
  markSaved(null, 'untitled.md');
  view.focus();
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
  markSaved(result.path, result.name);
  view.focus();
}

async function save() {
  if (!currentPath) return saveAs();
  const result = await window.markpad.saveFile(currentPath, fullDoc());
  if (!result.ok) {
    ui.showError(`Could not save file: ${result.error}`);
    return false;
  }
  markSaved(currentPath, currentName);
  return true;
}

async function saveAs() {
  const result = await window.markpad.saveFileAs(fullDoc());
  if (!result) return false; // cancelled
  if (!result.ok) {
    ui.showError(`Could not save file: ${result.error}`);
    return false;
  }
  markSaved(result.path, result.name);
  return true;
}

registerFileActions({ newFile, openFile, save, saveAs });

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
