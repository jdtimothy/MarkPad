import {
  parseFrontmatter,
  serializeFrontmatter,
  defaultFrontmatter,
} from './frontmatter.js';

export function createFrontmatterPanel(root, onChange) {
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
        const key = document.createElement('input');
        key.className = 'fm-key';
        key.placeholder = 'key';
        key.value = row.key;
        key.addEventListener('input', () => {
          row.key = key.value;
          onChange();
        });
        const value = document.createElement('input');
        value.className = 'fm-value';
        value.placeholder = 'value';
        value.value = row.value;
        value.addEventListener('input', () => {
          row.value = value.value;
          onChange();
        });
        const del = document.createElement('button');
        del.textContent = '✕';
        del.title = 'Remove property';
        del.addEventListener('click', () => {
          rows.splice(i, 1);
          render();
          onChange();
        });
        rowEl.append(key, value, del);
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
