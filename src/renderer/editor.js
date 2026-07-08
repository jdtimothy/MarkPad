import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';

export function createEditor(parent, onChange) {
  return new EditorView({
    parent,
    extensions: [
      basicSetup,
      markdown({ base: markdownLanguage }),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged || update.selectionSet) onChange();
      }),
    ],
  });
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
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: 0 },
  });
}
