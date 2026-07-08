import * as fmt from './formatting.js';
import { applyFormat, getDoc } from './editor.js';
import { renderPreview } from './preview.js';

// Filled in by registerFileActions (Task 10). Until then, no-ops.
let fileActions = { newFile() {}, openFile() {}, save() {}, saveAs() {} };

export function registerFileActions(handlers) {
  fileActions = handlers;
}

export function initUI(view) {
  const editorPane = document.getElementById('editor-pane');
  const previewPane = document.getElementById('preview-pane');
  const modeEdit = document.getElementById('mode-edit');
  const modePreview = document.getElementById('mode-preview');
  const banner = document.getElementById('error-banner');
  const bannerMsg = document.getElementById('error-message');
  const urlDialog = document.getElementById('url-dialog');
  const urlInput = document.getElementById('url-input');
  const urlLabel = document.getElementById('url-label');

  // --- error banner ---
  function showError(message) {
    bannerMsg.textContent = message;
    banner.classList.remove('hidden');
  }
  document.getElementById('error-dismiss').addEventListener('click', () => {
    banner.classList.add('hidden');
  });

  // --- URL dialog (window.prompt does not exist in Electron) ---
  function askUrl(label) {
    return new Promise((resolve) => {
      urlLabel.textContent = label;
      urlInput.value = '';
      urlDialog.returnValue = 'cancel';
      urlDialog.showModal();
      urlDialog.addEventListener(
        'close',
        () => resolve(urlDialog.returnValue === 'ok' ? urlInput.value.trim() : null),
        { once: true }
      );
    });
  }

  async function insertUrl(kind) {
    const url = await askUrl(kind === 'link' ? 'Link URL' : 'Image URL');
    if (!url) { view.focus(); return; }
    applyFormat(view, kind === 'link' ? fmt.insertLink : fmt.insertImage, url);
  }

  // --- view toggle ---
  let mode = 'edit';
  let savedScrollTop = 0;

  async function setMode(next) {
    if (next === mode) return;
    mode = next;
    modeEdit.classList.toggle('active', mode === 'edit');
    modePreview.classList.toggle('active', mode === 'preview');
    if (mode === 'preview') {
      savedScrollTop = view.scrollDOM.scrollTop;
      await renderPreview(previewPane, getDoc(view));
      editorPane.classList.add('hidden');
      previewPane.classList.remove('hidden');
    } else {
      previewPane.classList.add('hidden');
      editorPane.classList.remove('hidden');
      view.scrollDOM.scrollTop = savedScrollTop;
      view.focus();
    }
  }

  modeEdit.addEventListener('click', () => setMode('edit'));
  modePreview.addEventListener('click', () => setMode('preview'));

  // --- toolbar actions ---
  const actions = {
    new: () => fileActions.newFile(),
    open: () => fileActions.openFile(),
    save: () => fileActions.save(),
    h1: () => applyFormat(view, fmt.toggleHeading, 1),
    h2: () => applyFormat(view, fmt.toggleHeading, 2),
    h3: () => applyFormat(view, fmt.toggleHeading, 3),
    bold: () => applyFormat(view, fmt.toggleInline, '**'),
    italic: () => applyFormat(view, fmt.toggleInline, '*'),
    strike: () => applyFormat(view, fmt.toggleInline, '~~'),
    code: () => applyFormat(view, fmt.toggleInline, '`'),
    codeblock: () => applyFormat(view, fmt.insertCodeBlock),
    link: () => insertUrl('link'),
    image: () => insertUrl('image'),
    quote: () => applyFormat(view, fmt.toggleBlockquote),
    bullet: () => applyFormat(view, fmt.toggleList, 'bullet'),
    ordered: () => applyFormat(view, fmt.toggleList, 'ordered'),
    task: () => applyFormat(view, fmt.toggleList, 'task'),
    table: () => applyFormat(view, fmt.insertTable),
    hr: () => applyFormat(view, fmt.insertHorizontalRule),
  };

  document.getElementById('toolbar').addEventListener('click', (e) => {
    const action = e.target.closest('button')?.dataset.action;
    if (action && actions[action]) actions[action]();
  });

  // --- keyboard shortcuts ---
  window.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    // b/i/k mutate or target the (hidden) editor, so they only make sense
    // in Edit mode; e/n/o/s stay available in Preview.
    if (mode !== 'edit' && (key === 'b' || key === 'i' || key === 'k')) return;
    const shortcuts = {
      b: actions.bold,
      i: actions.italic,
      k: actions.link,
      e: () => setMode(mode === 'edit' ? 'preview' : 'edit'),
      n: actions.new,
      o: actions.open,
      s: e.shiftKey ? () => fileActions.saveAs() : actions.save,
    };
    if (shortcuts[key]) {
      e.preventDefault();
      shortcuts[key]();
    }
  });

  // --- status bar ---
  const statusFile = document.getElementById('status-file');
  const statusWords = document.getElementById('status-words');
  const statusLine = document.getElementById('status-line');

  function updateStatus() {
    const doc = getDoc(view);
    const words = doc.split(/\s+/).filter(Boolean).length;
    statusWords.textContent = `${words} words`;
    const line = view.state.doc.lineAt(view.state.selection.main.head).number;
    statusLine.textContent = `Ln ${line}`;
  }

  function setStatusFile(name, dirty) {
    statusFile.textContent = dirty ? `${name} ●` : name;
    document.title = dirty ? `${name} ● — MarkPad` : `${name} — MarkPad`;
  }

  updateStatus();
  setStatusFile('untitled.md', false);

  return { showError, setStatusFile, updateStatus };
}
