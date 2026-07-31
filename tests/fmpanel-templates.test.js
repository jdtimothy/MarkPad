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
    // Applying expands the panel itself; toggling here would close it again.
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
