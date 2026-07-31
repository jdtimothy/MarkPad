import {
  parseFrontmatter,
  serializeFrontmatter,
  defaultFrontmatter,
} from './frontmatter.js';
import { wantsImagePicker } from './github-paths.js';

// onPickImage is optional: when supplied it resolves to { url } for an image
// the caller has staged, or null if the user cancelled. Rows whose key or
// value looks image-shaped grow a picker button that fills in the value.
export function createFrontmatterPanel(root, onChange, { onPickImage = null } = {}) {
  let rows = null; // null = document has no frontmatter
  let collapsed = true;

  function pairCount() {
    return rows.filter((r) => r.raw === undefined).length;
  }

  function render() {
    root.innerHTML = '';

    if (rows === null) {
      const add = document.createElement('button');
      add.id = 'fm-add';
      add.textContent = '+ Add frontmatter';
      add.addEventListener('click', () => {
        const today = new Date().toISOString().slice(0, 10);
        rows = defaultFrontmatter(today);
        collapsed = false;
        render();
        onChange();
      });
      root.appendChild(add);
      return;
    }

    const header = document.createElement('div');
    header.className = 'fm-header';
    const toggle = document.createElement('button');
    toggle.textContent = `${collapsed ? '▸' : '▾'} Frontmatter (${pairCount()})`;
    toggle.addEventListener('click', () => {
      collapsed = !collapsed;
      render();
    });
    const remove = document.createElement('button');
    remove.className = 'fm-remove';
    remove.textContent = 'Remove frontmatter';
    remove.addEventListener('click', () => {
      rows = null;
      render();
      onChange();
    });
    header.append(toggle, remove);
    root.appendChild(header);

    if (collapsed) return;

    const list = document.createElement('div');
    list.className = 'fm-rows';
    rows.forEach((row, i) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'fm-row';
      if (row.raw !== undefined) {
        const raw = document.createElement('code');
        raw.className = 'fm-raw';
        raw.textContent = row.raw;
        rowEl.appendChild(raw);
      } else {
        // Assigned below when a picker is available; re-evaluated on every
        // keystroke so typing "hero" reveals the button without a re-render
        // that would steal the caret.
        let syncPicker = () => {};

        const key = document.createElement('input');
        key.className = 'fm-key';
        key.placeholder = 'key';
        key.value = row.key;
        key.addEventListener('input', () => {
          row.key = key.value;
          syncPicker();
          onChange();
        });
        const value = document.createElement('input');
        value.className = 'fm-value';
        value.placeholder = 'value';
        value.value = row.value;
        value.addEventListener('input', () => {
          row.value = value.value;
          syncPicker();
          onChange();
        });
        const del = document.createElement('button');
        del.textContent = '✕';
        del.title = 'Remove property';
        del.addEventListener('click', () => {
          rows.splice(i, 1);
          if (rows.length === 0) rows = null;
          render();
          onChange();
        });

        rowEl.append(key, value);

        if (onPickImage) {
          const pick = document.createElement('button');
          pick.className = 'fm-image';
          pick.textContent = '🖼';
          pick.title = 'Choose an image';
          pick.addEventListener('click', async () => {
            const picked = await onPickImage();
            if (!picked?.url) return;
            row.value = picked.url;
            value.value = picked.url;
            syncPicker();
            onChange();
          });
          syncPicker = () => {
            pick.classList.toggle('hidden', !wantsImagePicker(row.key, row.value));
          };
          syncPicker();
          rowEl.append(pick);
        }

        rowEl.append(del);
      }
      list.appendChild(rowEl);
    });

    const addProp = document.createElement('button');
    addProp.className = 'fm-add-prop';
    addProp.textContent = '+ Add property';
    addProp.addEventListener('click', () => {
      rows.push({ key: '', value: '' });
      render();
      const keys = root.querySelectorAll('.fm-key');
      keys[keys.length - 1].focus();
      onChange();
    });
    list.appendChild(addProp);
    root.appendChild(list);
  }

  render();

  return {
    setFrontmatter(fm) {
      rows = fm === null ? null : parseFrontmatter(fm);
      collapsed = true;
      render();
    },
    getFrontmatter() {
      if (rows === null || rows.length === 0) return null;
      return serializeFrontmatter(rows);
    },
  };
}
