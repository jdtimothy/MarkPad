import {
  parseFrontmatter,
  serializeFrontmatter,
  defaultFrontmatter,
} from './frontmatter.js';
import { wantsImagePicker } from './github-paths.js';
import {
  applyTemplate,
  expandDefaults,
  ensureSeeded,
  listTemplates,
  saveTemplate,
  deleteTemplate,
  renameTemplate,
  templateFromRows,
} from './templates.js';

const isoToday = () => new Date().toISOString().slice(0, 10);

// onPickImage is optional: when supplied it resolves to { url } for an image
// the caller has staged, or null if the user cancelled. Rows whose key or
// value looks image-shaped grow a picker button that fills in the value.
// store and today exist so tests can inject them; production passes neither.
export function createFrontmatterPanel(
  root,
  onChange,
  { onPickImage = null, store = globalThis.localStorage, today = isoToday } = {}
) {
  let rows = null; // null = document has no frontmatter
  let collapsed = true;

  // Seeded once per store, so the list is never empty on a first run.
  ensureSeeded(store, defaultFrontmatter('{today}'));

  // Applying is additive: it fills in keys the document lacks and never
  // touches a value already there, so this is safe to press at any time.
  function chooseTemplate(name) {
    const template = listTemplates(store).find((t) => t.name === name);
    if (!template) return;
    rows = applyTemplate(rows, expandDefaults(template.rows, today()));
    collapsed = false;
    render();
    onChange();
  }

  // Electron does not implement window.prompt(), so naming uses the app's
  // own dialog. Resolves to the trimmed name, or null if cancelled.
  function askName(labelText, okText, initial = '') {
    const dialog = document.getElementById('template-dialog');
    const input = document.getElementById('template-name');
    document.getElementById('template-label').textContent = labelText;
    document.getElementById('template-ok').textContent = okText;
    input.value = initial;
    dialog.returnValue = 'cancel';
    dialog.showModal();
    input.select?.();
    return new Promise((resolve) => {
      dialog.addEventListener('close', () => {
        resolve(dialog.returnValue === 'ok' ? input.value.trim() : null);
      }, { once: true });
    });
  }

  async function saveAsTemplate() {
    const captured = templateFromRows(rows || [], today());
    if (captured.length === 0) return;
    const name = await askName('Template name', 'Save template');
    if (!name) return;
    const exists = listTemplates(store).some((t) => t.name === name);
    if (exists && !window.confirm(`Replace the template "${name}"?`)) return;
    saveTemplate(store, name, captured);
    render();
  }

  function renderManageList() {
    const list = document.getElementById('template-manage-list');
    list.innerHTML = '';
    const templates = listTemplates(store);

    if (templates.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'fm-manage-empty';
      empty.textContent = 'No templates yet. Save one from a document\'s frontmatter.';
      list.append(empty);
      return;
    }

    for (const template of templates) {
      const row = document.createElement('div');
      row.className = 'fm-manage-row';

      const name = document.createElement('span');
      name.className = 'fm-manage-name';
      name.textContent = template.name;

      const rename = document.createElement('button');
      rename.className = 'fm-manage-rename';
      rename.textContent = 'Rename';
      rename.addEventListener('click', async () => {
        const next = await askName('Rename template', 'Rename', template.name);
        if (!next || next === template.name) return;
        if (!renameTemplate(store, template.name, next)) {
          window.alert(`Could not rename to "${next}" — that name is already taken.`);
          return;
        }
        renderManageList();
        render();
      });

      const remove = document.createElement('button');
      remove.className = 'fm-manage-delete';
      remove.textContent = 'Delete';
      remove.addEventListener('click', () => {
        if (!window.confirm(`Delete the template "${template.name}"?`)) return;
        deleteTemplate(store, template.name);
        renderManageList();
        render();
      });

      row.append(name, rename, remove);
      list.append(row);
    }
  }

  function openManage() {
    const dialog = document.getElementById('template-manage-dialog');
    renderManageList();
    document.getElementById('template-manage-close')
      .addEventListener('click', () => dialog.close(), { once: true });
    dialog.showModal();
  }

  function renderTemplateBar() {
    const bar = document.createElement('div');
    bar.className = 'fm-template-bar';

    const label = document.createElement('span');
    label.className = 'fm-template-label';
    label.textContent = 'Template';

    const select = document.createElement('select');
    select.className = 'fm-template-select';
    const placeholder = new Option('Choose…', '');
    placeholder.disabled = true;
    placeholder.selected = true;
    select.append(placeholder);
    for (const template of listTemplates(store)) {
      select.append(new Option(template.name, template.name));
    }
    select.append(new Option('Manage…', '__manage__'));
    select.addEventListener('change', () => {
      const chosen = select.value;
      // The control is an action, not a record of what the document is:
      // MarkPad cannot know a document still "is" a blog post once edited.
      select.selectedIndex = 0;
      if (chosen === '__manage__') openManage();
      else if (chosen) chooseTemplate(chosen);
    });

    bar.append(label, select);

    // Only offered when there is something to capture.
    if (rows && rows.some((r) => r.raw === undefined)) {
      const save = document.createElement('button');
      save.className = 'fm-template-save';
      save.textContent = 'Save as template…';
      save.addEventListener('click', saveAsTemplate);
      bar.append(save);
    }

    root.appendChild(bar);
  }

  function pairCount() {
    return rows.filter((r) => r.raw === undefined).length;
  }

  function render() {
    root.innerHTML = '';

    if (rows === null) {
      // Nothing to collapse yet, and this is the state where starting from a
      // template is most useful — so the chooser belongs here.
      renderTemplateBar();

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

    // Part of the expanded body: no reason to occupy space while the panel
    // is collapsed.
    renderTemplateBar();

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
        // Both of these re-evaluate on every keystroke, toggling elements in
        // place rather than re-rendering the row, which would steal the caret.
        let syncPicker = () => {};
        let syncWarning = () => {};

        const key = document.createElement('input');
        key.className = 'fm-key';
        key.placeholder = 'key';
        key.value = row.key;
        key.addEventListener('input', () => {
          row.key = key.value;
          syncPicker();
          syncWarning();
          onChange();
        });
        const value = document.createElement('input');
        value.className = 'fm-value';
        value.placeholder = 'value';
        value.value = row.value;
        value.addEventListener('input', () => {
          row.value = value.value;
          syncPicker();
          syncWarning();
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

        // An empty value serializes to `key:`, which is null in YAML. Most
        // site generators reject that where they would accept a missing key
        // or an empty string. Visual only — it never blocks a save.
        const warn = document.createElement('span');
        warn.className = 'fm-warn';
        warn.textContent = '⚠';
        warn.title =
          'This value is empty, so it becomes null in YAML. Most site generators reject that — give it a value or remove the row.';
        syncWarning = () => {
          const isEmpty = row.key.trim() !== '' && row.value.trim() === '';
          warn.classList.toggle('hidden', !isEmpty);
        };
        syncWarning();

        rowEl.append(key, value, warn);

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
            syncWarning();
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
