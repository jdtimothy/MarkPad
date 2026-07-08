import * as fmt from './formatting.js';
import { applyFormat, getDoc, setDoc } from './editor.js';
import { renderPreview } from './preview.js';
import { htmlToMarkdown } from './rendered-editor.js';

let fileActions = { newFile() {}, openFile() {}, save() {}, saveAs() {} };

export function registerFileActions(handlers) {
  fileActions = handlers;
}

export function initUI(view, onRenderedChange = () => {}) {
  const editorPane = document.getElementById('editor-pane');
  const previewPane = document.getElementById('preview-pane');
  const modeEdit = document.getElementById('mode-edit');
  const modePreview = document.getElementById('mode-preview');
  const banner = document.getElementById('error-banner');
  const bannerMsg = document.getElementById('error-message');
  const urlDialog = document.getElementById('url-dialog');
  const urlInput = document.getElementById('url-input');
  const urlLabel = document.getElementById('url-label');
  const toolbar = document.getElementById('toolbar');
  const actionButtons = Array.from(toolbar.querySelectorAll('button[data-action]'));

  function showError(message) {
    bannerMsg.textContent = message;
    banner.classList.remove('hidden');
  }
  document.getElementById('error-dismiss').addEventListener('click', () => {
    banner.classList.add('hidden');
  });

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

  function saveRenderedSelection() {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!previewPane.contains(range.commonAncestorContainer)) return null;
    return range.cloneRange();
  }

  function restoreRenderedSelection(range) {
    if (!range) {
      previewPane.focus();
      return;
    }
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    previewPane.focus();
  }

  function closestRenderedBlock(selector) {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    let node = selection.getRangeAt(0).startContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    return node?.closest?.(selector);
  }

  function closestInlineCode() {
    const code = closestRenderedBlock('code');
    return code && !code.closest('pre') ? code : null;
  }

  function renderedSelectionNode() {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!previewPane.contains(range.commonAncestorContainer)) return null;
    let node = range.startContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    return node;
  }

  function currentRenderedRange() {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (!previewPane.contains(range.commonAncestorContainer)) return null;
    return range;
  }

  function closestEditableBlock() {
    const node = renderedSelectionNode();
    if (!node) return null;
    return node.closest('p,div,li,h1,h2,h3,h4,h5,h6,blockquote,pre,ul,ol,table') || previewPane;
  }

  function placeCaretAtStart(element) {
    const range = document.createRange();
    range.setStart(element, 0);
    range.collapse(true);
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function placeCaretAfter(node) {
    const range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function exitRenderedBlock(block) {
    const paragraph = document.createElement('p');
    paragraph.appendChild(document.createElement('br'));
    block.after(paragraph);
    placeCaretAtStart(paragraph);
    syncFromRendered();
  }

  function exitInlineCode(code) {
    const spacer = document.createTextNode(' ');
    code.after(spacer);
    placeCaretAfter(spacer);
    syncFromRendered();
  }

  function exitInlineCodeToNewBlock(code) {
    const anchorBlock = code.closest('p,div,li,h1,h2,h3,h4,h5,h6,blockquote') || code;
    const paragraph = document.createElement('p');
    paragraph.appendChild(document.createElement('br'));
    anchorBlock.after(paragraph);
    placeCaretAtStart(paragraph);
    syncFromRendered();
    updateToolbarState();
  }

  function insertInlineCode() {
    const existing = closestInlineCode();
    if (existing) {
      exitInlineCode(existing);
      return;
    }

    const range = currentRenderedRange();
    if (!range) return;
    const selected = range.toString();
    const code = document.createElement('code');
    code.textContent = selected || 'code';

    range.deleteContents();
    range.insertNode(code);

    if (selected) {
      const spacer = document.createTextNode(' ');
      code.after(spacer);
      placeCaretAfter(spacer);
    } else {
      const selectText = document.createRange();
      selectText.selectNodeContents(code);
      const selection = document.getSelection();
      selection.removeAllRanges();
      selection.addRange(selectText);
    }

    syncFromRendered();
    updateToolbarState();
  }

  function insertCodeBlock() {
    const existing = closestRenderedBlock('pre');
    if (existing) {
      exitRenderedBlock(existing);
      return;
    }

    const range = currentRenderedRange();
    const selected = range?.toString() || '';
    const anchorBlock = closestEditableBlock();
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = selected;
    pre.appendChild(code);

    if (range && !range.collapsed) range.deleteContents();

    if (!anchorBlock || anchorBlock === previewPane) {
      previewPane.appendChild(pre);
    } else {
      anchorBlock.after(pre);
    }

    placeCaretAtStart(code);
    syncFromRendered();
    updateToolbarState();
  }

  function currentPreLineIsBlank(pre) {
    const selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    if (!range.collapsed) return false;

    const before = range.cloneRange();
    before.selectNodeContents(pre);
    before.setEnd(range.startContainer, range.startOffset);
    const textBefore = before.toString();
    const currentLine = textBefore.slice(textBefore.lastIndexOf('\n') + 1);
    return currentLine.trim() === '';
  }

  let mode = 'preview';
  let savedScrollTop = 0;
  let syncingRendered = false;

  function notifyRenderedChanged() {
    updateStatus();
    updateToolbarState();
    onRenderedChange();
  }

  function syncFromRendered() {
    if (mode !== 'preview') return;
    if (syncingRendered) return;
    const nextDoc = htmlToMarkdown(previewPane);
    if (nextDoc === getDoc(view)) return;
    syncingRendered = true;
    setDoc(view, nextDoc);
    syncingRendered = false;
    notifyRenderedChanged();
  }

  async function refreshRendered() {
    if (mode !== 'preview') return;
    syncingRendered = true;
    await renderPreview(previewPane, getDoc(view));
    syncingRendered = false;
    updateToolbarState();
  }

  async function setMode(next) {
    if (next === mode) return;
    if (mode === 'preview') syncFromRendered();

    mode = next;
    modeEdit.classList.toggle('active', mode === 'edit');
    modePreview.classList.toggle('active', mode === 'preview');

    if (mode === 'preview') {
      savedScrollTop = view.scrollDOM.scrollTop;
      await refreshRendered();
      editorPane.classList.add('hidden');
      previewPane.classList.remove('hidden');
      previewPane.focus();
    } else {
      previewPane.classList.add('hidden');
      editorPane.classList.remove('hidden');
      view.scrollDOM.scrollTop = savedScrollTop;
      view.focus();
    }
    updateToolbarState();
  }

  modeEdit.addEventListener('click', () => setMode('edit'));
  modePreview.addEventListener('click', () => setMode('preview'));

  previewPane.addEventListener('input', syncFromRendered);
  previewPane.addEventListener('change', (e) => {
    if (e.target?.matches?.('input[type="checkbox"]')) syncFromRendered();
  });
  previewPane.addEventListener('blur', () => {
    syncFromRendered();
    updateToolbarState();
  });
  previewPane.addEventListener('keyup', updateToolbarState);
  previewPane.addEventListener('mouseup', updateToolbarState);
  previewPane.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey) return;

    const inlineCode = closestInlineCode();
    if (inlineCode) {
      e.preventDefault();
      exitInlineCodeToNewBlock(inlineCode);
      return;
    }

    const pre = closestRenderedBlock('pre');
    if (pre) {
      if (!currentPreLineIsBlank(pre)) return;
      e.preventDefault();
      exitRenderedBlock(pre);
      return;
    }

    const quote = closestRenderedBlock('blockquote');
    if (quote) {
      e.preventDefault();
      exitRenderedBlock(quote);
    }
  });

  function selectedRenderedText(fallback = '') {
    const selection = document.getSelection();
    const text = selection?.toString() || fallback;
    return text.replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  }

  function commandRendered(command, value = null) {
    previewPane.focus();
    document.execCommand(command, false, value);
    syncFromRendered();
    updateToolbarState();
  }

  function insertRenderedHtml(html) {
    commandRendered('insertHTML', html);
  }

  function toggleRenderedHeading(level) {
    const heading = closestRenderedBlock(`h${level}`);
    commandRendered('formatBlock', heading ? 'p' : `h${level}`);
  }

  async function insertLink() {
    const renderedSelection = mode === 'preview' ? saveRenderedSelection() : null;
    const url = await askUrl('Link URL');
    if (!url) {
      (mode === 'preview' ? previewPane : view).focus();
      return;
    }
    if (mode === 'preview') {
      restoreRenderedSelection(renderedSelection);
      commandRendered('createLink', url);
    } else {
      applyFormat(view, fmt.insertLink, url);
    }
  }

  async function insertImage() {
    const renderedSelection = mode === 'preview' ? saveRenderedSelection() : null;
    let image = null;
    if (window.markpad?.openImage) image = await window.markpad.openImage();

    const url = image?.url || await askUrl('Image URL');
    if (!url) {
      (mode === 'preview' ? previewPane : view).focus();
      return;
    }

    if (mode === 'preview') {
      restoreRenderedSelection(renderedSelection);
      const alt = selectedRenderedText(image?.name || 'image');
      insertRenderedHtml(`<img src="${url}" alt="${alt}">`);
    } else {
      applyFormat(view, fmt.insertImage, url);
    }
  }

  const codeActions = {
    h1: () => applyFormat(view, fmt.toggleHeading, 1),
    h2: () => applyFormat(view, fmt.toggleHeading, 2),
    h3: () => applyFormat(view, fmt.toggleHeading, 3),
    bold: () => applyFormat(view, fmt.toggleInline, '**'),
    italic: () => applyFormat(view, fmt.toggleInline, '*'),
    strike: () => applyFormat(view, fmt.toggleInline, '~~'),
    code: () => applyFormat(view, fmt.toggleInline, '`'),
    codeblock: () => applyFormat(view, fmt.insertCodeBlock),
    quote: () => applyFormat(view, fmt.toggleBlockquote),
    bullet: () => applyFormat(view, fmt.toggleList, 'bullet'),
    ordered: () => applyFormat(view, fmt.toggleList, 'ordered'),
    task: () => applyFormat(view, fmt.toggleList, 'task'),
    table: () => applyFormat(view, fmt.insertTable),
    hr: () => applyFormat(view, fmt.insertHorizontalRule),
  };

  const renderedActions = {
    h1: () => toggleRenderedHeading(1),
    h2: () => toggleRenderedHeading(2),
    h3: () => toggleRenderedHeading(3),
    bold: () => commandRendered('bold'),
    italic: () => commandRendered('italic'),
    strike: () => commandRendered('strikeThrough'),
    code: () => insertInlineCode(),
    codeblock: () => insertCodeBlock(),
    quote: () => {
      const quote = closestRenderedBlock('blockquote');
      if (quote) exitRenderedBlock(quote);
      else commandRendered('formatBlock', 'blockquote');
    },
    bullet: () => commandRendered('insertUnorderedList'),
    ordered: () => commandRendered('insertOrderedList'),
    task: () => insertRenderedHtml(`<ul><li><input type="checkbox"> ${selectedRenderedText('Task')}</li></ul>`),
    table: () => {
      const table = closestRenderedBlock('table');
      if (table) exitRenderedBlock(table);
      else insertRenderedHtml('<table><thead><tr><th>Column 1</th><th>Column 2</th><th>Column 3</th></tr></thead><tbody><tr><td></td><td></td><td></td></tr></tbody></table>');
    },
    hr: () => commandRendered('insertHorizontalRule'),
  };

  function runFormatAction(action) {
    if (mode === 'preview') renderedActions[action]?.();
    else codeActions[action]?.();
    updateToolbarState();
  }

  const actions = {
    new: () => fileActions.newFile(),
    open: () => fileActions.openFile(),
    save: () => {
      if (mode === 'preview') syncFromRendered();
      return fileActions.save();
    },
    link: () => insertLink(),
    image: () => insertImage(),
  };

  for (const action of Object.keys(codeActions)) {
    actions[action] = () => runFormatAction(action);
  }

  toolbar.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) e.preventDefault();
  });

  toolbar.addEventListener('click', (e) => {
    const action = e.target.closest('button')?.dataset.action;
    if (action && actions[action]) actions[action]();
  });

  window.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    const shortcuts = {
      b: actions.bold,
      i: actions.italic,
      k: actions.link,
      e: () => setMode(mode === 'edit' ? 'preview' : 'edit'),
      n: actions.new,
      o: actions.open,
      s: e.shiftKey ? () => {
        if (mode === 'preview') syncFromRendered();
        return fileActions.saveAs();
      } : actions.save,
    };
    if (shortcuts[key]) {
      e.preventDefault();
      shortcuts[key]();
    }
  });
  document.addEventListener('selectionchange', () => {
    if (mode === 'preview') updateToolbarState();
  });

  const statusFile = document.getElementById('status-file');
  const statusWords = document.getElementById('status-words');
  const statusLine = document.getElementById('status-line');

  function updateStatus() {
    const doc = getDoc(view);
    const words = doc.split(/\s+/).filter(Boolean).length;
    statusWords.textContent = `${words} words`;
    const line = view.state.doc.lineAt(view.state.selection.main.head).number;
    statusLine.textContent = mode === 'preview' ? 'Rendered' : `Ln ${line}`;
    updateToolbarState();
  }

  function lineAtCursor() {
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    return {
      head,
      line,
      offset: head - line.from,
      text: line.text,
    };
  }

  function isInsideInlineMarker(doc, pos, marker) {
    const left = doc.lastIndexOf(marker, Math.max(0, pos - 1));
    if (left === -1) return false;
    const right = doc.indexOf(marker, pos);
    if (right === -1) return false;
    const content = doc.slice(left + marker.length, right);
    return content.length > 0 && !content.includes('\n');
  }

  function isInsideCodeFence(doc, pos) {
    const before = doc.slice(0, pos);
    const matches = before.match(/^```/gm);
    return Boolean(matches && matches.length % 2 === 1);
  }

  function codeToolbarState() {
    const doc = getDoc(view);
    const { head, text } = lineAtCursor();
    const beforeLine = doc.slice(0, head);
    const afterLine = doc.slice(head);
    const active = {
      h1: /^#\s/.test(text),
      h2: /^##\s/.test(text),
      h3: /^###\s/.test(text),
      bold: isInsideInlineMarker(doc, head, '**'),
      italic: isInsideInlineMarker(doc, head, '*') && !isInsideInlineMarker(doc, head, '**'),
      strike: isInsideInlineMarker(doc, head, '~~'),
      code: !isInsideCodeFence(doc, head) && isInsideInlineMarker(doc, head, '`'),
      codeblock: isInsideCodeFence(doc, head),
      quote: /^>\s?/.test(text),
      bullet: /^-\s(?!\[[ xX]\]\s)/.test(text),
      ordered: /^\d+\.\s/.test(text),
      task: /^-\s\[[ xX]\]\s/.test(text),
      link: /\[[^\]]*$/.test(beforeLine) && /^[^\n)]*\)/.test(afterLine),
      table: /\|/.test(text),
    };
    return active;
  }

  function renderedToolbarState() {
    const node = renderedSelectionNode();
    if (!node) return {};
    return {
      h1: Boolean(node.closest('h1')),
      h2: Boolean(node.closest('h2')),
      h3: Boolean(node.closest('h3')),
      bold: document.queryCommandState('bold') || Boolean(node.closest('strong,b')),
      italic: document.queryCommandState('italic') || Boolean(node.closest('em,i')),
      strike: document.queryCommandState('strikeThrough') || Boolean(node.closest('s,strike,del')),
      code: Boolean(node.closest('code')) && !Boolean(node.closest('pre')),
      codeblock: Boolean(node.closest('pre')),
      quote: Boolean(node.closest('blockquote')),
      bullet: Boolean(node.closest('ul')) && !Boolean(node.closest('li')?.querySelector(':scope > input[type="checkbox"]')),
      ordered: Boolean(node.closest('ol')),
      task: Boolean(node.closest('li')?.querySelector(':scope > input[type="checkbox"]')),
      link: Boolean(node.closest('a')),
      image: Boolean(node.closest('img')),
      table: Boolean(node.closest('table')),
    };
  }

  function updateToolbarState() {
    const active = mode === 'preview' ? renderedToolbarState() : codeToolbarState();
    for (const button of actionButtons) {
      const action = button.dataset.action;
      button.classList.toggle('active', Boolean(active[action]));
      button.setAttribute('aria-pressed', active[action] ? 'true' : 'false');
    }
  }

  function setStatusFile(name, dirty) {
    statusFile.textContent = dirty ? `${name} *` : name;
    document.title = dirty ? `${name} * - MarkPad` : `${name} - MarkPad`;
  }

  updateStatus();
  setStatusFile('untitled.md', false);
  refreshRendered();
  updateToolbarState();

  return { showError, setStatusFile, updateStatus, refreshRendered, syncFromRendered };
}
