import './styles.css';
import { createEditor } from './editor.js';

const view = createEditor(document.getElementById('editor-pane'), () => {});
view.focus();
