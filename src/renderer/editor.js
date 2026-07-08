import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';

// Extensions are stateless/reusable across documents, so we keep them keyed
// by view to rebuild a fresh EditorState (and thus a fresh undo history) in
// setDoc without duplicating the extension list.
const extensionsByView = new WeakMap();

export function createEditor(parent, onChange) {
  const extensions = [
    basicSetup,
    markdown({ base: markdownLanguage }),
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      if (update.docChanged || update.selectionSet) onChange();
    }),
  ];
  const view = new EditorView({ parent, extensions });
  extensionsByView.set(view, extensions);
  return view;
}

export function applyFormat(view, fn, ...args) {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc.toString();
  const result = fn({ doc, from, to }, ...args);
  view.dispatch({
    changes: { from: 0, to: doc.length, insert: result.doc },
    selection: { anchor: result.from, head: result.to },
  });
  view.focus();
}

export function getDoc(view) {
  return view.state.doc.toString();
}

export function setDoc(view, text) {
  const extensions = extensionsByView.get(view) || [];
  view.setState(EditorState.create({ doc: text, extensions }));
}
