// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createFrontmatterPanel } from '../src/renderer/fmpanel.js';

function fakeStore(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
  };
}

function seeded(templates) {
  return {
    'markpad.templates': JSON.stringify({ version: 1, seeded: true, templates }),
  };
}

function mount(store, today = () => '2026-07-31') {
  const root = document.createElement('div');
  document.body.append(root);
  const panel = createFrontmatterPanel(root, () => {}, { store, today });
  return { root, panel };
}

const select = (root) => root.querySelector('.fm-template-select');
const optionNames = (root) => [...select(root).options].map((o) => o.textContent);

// Just the saved templates. Ignoring the fixed entries keeps these assertions
// stable when Task 6 adds "Manage…" to the same control.
const templateNames = (root) =>
  optionNames(root).filter((n) => n !== 'Choose…' && n !== 'Manage…');

function choose(root, name) {
  const el = select(root);
  el.value = name;
  el.dispatchEvent(new Event('change'));
}

function keysIn(root) {
  return [...root.querySelectorAll('.fm-key')].map((i) => i.value);
}

// The chooser lives inside the expanded body, so a document that already has
// frontmatter has to be opened before it can be reached.
function expand(root) {
  root.querySelector('.fm-header button').click();
}

beforeEach(() => {
  document.body.innerHTML = '';
});

const BLOG = [
  { key: 'title', value: '' },
  { key: 'pubDate', value: '{today}' },
  { key: 'tags', value: '[]' },
];

describe('template selector', () => {
  it('is visible on a document with no frontmatter', () => {
    const { root } = mount(fakeStore(seeded({ 'Blog post': BLOG })));
    expect(select(root)).not.toBeNull();
    expect(templateNames(root)).toEqual(['Blog post']);
  });

  it('opens with the placeholder selected, and the placeholder is disabled', () => {
    const { root } = mount(fakeStore(seeded({ 'Blog post': BLOG })));
    expect(select(root).selectedIndex).toBe(0);
    expect(select(root).options[0].disabled).toBe(true);
  });

  it('creates frontmatter from a template when there is none', () => {
    const { root, panel } = mount(fakeStore(seeded({ 'Blog post': BLOG })));
    choose(root, 'Blog post');
    expect(keysIn(root)).toEqual(['title', 'pubDate', 'tags']);
    expect(panel.getFrontmatter()).toContain('pubDate: 2026-07-31');
  });

  it('expands the panel so the result is visible', () => {
    const { root } = mount(fakeStore(seeded({ 'Blog post': BLOG })));
    choose(root, 'Blog post');
    expect(root.querySelector('.fm-rows')).not.toBeNull();
  });

  it('adds only missing keys to existing frontmatter', () => {
    const { root, panel } = mount(fakeStore(seeded({ 'Blog post': BLOG })));
    panel.setFrontmatter('title: My Post\n');
    expand(root);
    choose(root, 'Blog post');
    expect(keysIn(root)).toEqual(['title', 'pubDate', 'tags']);
    expect(panel.getFrontmatter()).toContain('title: My Post');
  });

  it('returns to the placeholder after applying', () => {
    const { root } = mount(fakeStore(seeded({ 'Blog post': BLOG })));
    choose(root, 'Blog post');
    expect(select(root).selectedIndex).toBe(0);
  });

  it('can be applied twice with no duplicate keys', () => {
    const { root } = mount(fakeStore(seeded({ 'Blog post': BLOG })));
    choose(root, 'Blog post');
    choose(root, 'Blog post');
    expect(keysIn(root)).toEqual(['title', 'pubDate', 'tags']);
  });

  it('seeds Basic into an untouched store', () => {
    const store = fakeStore();
    const { root } = mount(store);
    expect(templateNames(root)).toEqual(['Basic']);
  });

  it('is hidden while the panel is collapsed', () => {
    const { root, panel } = mount(fakeStore(seeded({ 'Blog post': BLOG })));
    panel.setFrontmatter('title: My Post\n');
    expect(select(root)).toBeNull();

    expand(root);
    expect(select(root)).not.toBeNull();
  });

  it('reports the change so the document becomes dirty', () => {
    const root = document.createElement('div');
    document.body.append(root);
    let changes = 0;
    createFrontmatterPanel(root, () => { changes += 1; }, {
      store: fakeStore(seeded({ 'Blog post': BLOG })),
      today: () => '2026-07-31',
    });
    root.querySelector('.fm-template-select').value = 'Blog post';
    root.querySelector('.fm-template-select').dispatchEvent(new Event('change'));
    expect(changes).toBeGreaterThan(0);
  });
});

// The dialog lives in index.html; the tests build the same nodes.
function installDialog() {
  document.body.insertAdjacentHTML('beforeend', `
    <dialog id="template-dialog">
      <form method="dialog">
        <label id="template-label" for="template-name">Template name</label>
        <input id="template-name" type="text" />
        <div class="dialog-buttons">
          <button value="cancel">Cancel</button>
          <button value="ok" id="template-ok">Save template</button>
        </div>
      </form>
    </dialog>
  `);
  const dialog = document.getElementById('template-dialog');
  // jsdom implements neither showModal nor close.
  dialog.showModal = function () { this.open = true; };
  dialog.close = function (value) {
    this.open = false;
    if (value !== undefined) this.returnValue = value;
    this.dispatchEvent(new Event('close'));
  };
  return dialog;
}

function answerDialog(dialog, name) {
  document.getElementById('template-name').value = name;
  dialog.close('ok');
}

describe('save as template', () => {
  it('is hidden when the document has no frontmatter to save', () => {
    installDialog();
    const { root } = mount(fakeStore(seeded({})));
    expect(root.querySelector('.fm-template-save')).toBeNull();
  });

  it('captures the current rows under the given name', async () => {
    const dialog = installDialog();
    const store = fakeStore(seeded({}));
    const { root, panel } = mount(store);
    panel.setFrontmatter('title: My Post\ntags: [a]\n');
    expand(root);

    root.querySelector('.fm-template-save').click();
    answerDialog(dialog, 'Blog post');
    await Promise.resolve();
    await Promise.resolve();

    const stored = JSON.parse(store.data['markpad.templates']).templates;
    expect(stored['Blog post']).toEqual([
      { key: 'title', value: 'My Post' },
      { key: 'tags', value: '[a]' },
    ]);
  });

  it('stores today\'s date as the token', async () => {
    const dialog = installDialog();
    const store = fakeStore(seeded({}));
    const { root, panel } = mount(store);
    panel.setFrontmatter('date: 2026-07-31\n');
    expand(root);

    root.querySelector('.fm-template-save').click();
    answerDialog(dialog, 'Dated');
    await Promise.resolve();
    await Promise.resolve();

    const stored = JSON.parse(store.data['markpad.templates']).templates;
    expect(stored.Dated).toEqual([{ key: 'date', value: '{today}' }]);
  });

  it('saves nothing when the name is cancelled', async () => {
    const dialog = installDialog();
    const store = fakeStore(seeded({}));
    const { root, panel } = mount(store);
    panel.setFrontmatter('title: x\n');
    expand(root);

    root.querySelector('.fm-template-save').click();
    dialog.close('cancel');
    await Promise.resolve();
    await Promise.resolve();

    expect(JSON.parse(store.data['markpad.templates']).templates).toEqual({});
  });

  it('offers the new template in the selector straight away', async () => {
    const dialog = installDialog();
    const { root, panel } = mount(fakeStore(seeded({})));
    panel.setFrontmatter('title: x\n');
    expand(root);

    root.querySelector('.fm-template-save').click();
    answerDialog(dialog, 'Fresh');
    await Promise.resolve();
    await Promise.resolve();

    expect(templateNames(root)).toContain('Fresh');
  });
});

function installManageDialog() {
  document.body.insertAdjacentHTML('beforeend', `
    <dialog id="template-manage-dialog">
      <h3>Templates</h3>
      <div id="template-manage-list"></div>
      <div class="dialog-buttons">
        <button id="template-manage-close" type="button">Close</button>
      </div>
    </dialog>
  `);
  const dialog = document.getElementById('template-manage-dialog');
  dialog.showModal = function () { this.open = true; };
  dialog.close = function () { this.open = false; this.dispatchEvent(new Event('close')); };
  return dialog;
}

const manageRows = () =>
  [...document.querySelectorAll('.fm-manage-row')].map(
    (r) => r.querySelector('.fm-manage-name').textContent
  );

describe('manage templates', () => {
  it('lists every template', () => {
    installDialog();
    const manage = installManageDialog();
    const { root } = mount(fakeStore(seeded({ A: [{ key: 'a', value: '' }], B: [{ key: 'b', value: '' }] })));

    choose(root, '__manage__');
    expect(manage.open).toBe(true);
    expect(manageRows()).toEqual(['A', 'B']);
  });

  it('does not apply anything when Manage is chosen', () => {
    installDialog();
    installManageDialog();
    const { root, panel } = mount(fakeStore(seeded({ A: [{ key: 'a', value: '' }] })));
    choose(root, '__manage__');
    expect(panel.getFrontmatter()).toBeNull();
  });

  it('deletes after confirmation', () => {
    installDialog();
    installManageDialog();
    const store = fakeStore(seeded({ A: [{ key: 'a', value: '' }] }));
    const { root } = mount(store);
    const confirm = window.confirm;
    window.confirm = () => true;

    choose(root, '__manage__');
    document.querySelector('.fm-manage-delete').click();

    window.confirm = confirm;
    expect(manageRows()).toEqual([]);
    expect(templateNames(root)).toEqual([]);
  });

  it('keeps the template when the deletion is declined', () => {
    installDialog();
    installManageDialog();
    const { root } = mount(fakeStore(seeded({ A: [{ key: 'a', value: '' }] })));
    const confirm = window.confirm;
    window.confirm = () => false;

    choose(root, '__manage__');
    document.querySelector('.fm-manage-delete').click();

    window.confirm = confirm;
    expect(manageRows()).toEqual(['A']);
  });

  it('renames through the name dialog', async () => {
    const nameDialog = installDialog();
    installManageDialog();
    const store = fakeStore(seeded({ A: [{ key: 'a', value: '' }] }));
    const { root } = mount(store);

    choose(root, '__manage__');
    document.querySelector('.fm-manage-rename').click();
    answerDialog(nameDialog, 'Renamed');
    await Promise.resolve();
    await Promise.resolve();

    expect(manageRows()).toEqual(['Renamed']);
    expect(templateNames(root)).toContain('Renamed');
  });
});
