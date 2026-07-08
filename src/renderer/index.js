import './styles.css';
import 'katex/dist/katex.min.css';
import { createEditor } from './editor.js';
import { initUI } from './ui.js';

let ui;
const view = createEditor(document.getElementById('editor-pane'), () => {
  if (ui) ui.updateStatus();
});
ui = initUI(view);
view.focus();
