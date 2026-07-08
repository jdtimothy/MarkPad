import './styles.css';
import 'katex/dist/katex.min.css';
import { createEditor } from './editor.js';
import { initUI } from './ui.js';
import { createFrontmatterPanel } from './fmpanel.js';

let ui;
const view = createEditor(document.getElementById('editor-pane'), () => {
  if (ui) ui.updateStatus();
});
ui = initUI(view);
const fmPanel = createFrontmatterPanel(
  document.getElementById('fm-panel'),
  () => {}
);
view.focus();
