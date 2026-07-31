// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createFrontmatterPanel } from '../src/renderer/fmpanel.js';

function mount() {
  const root = document.createElement('div');
  document.body.append(root);
  return { root, panel: createFrontmatterPanel(root, () => {}) };
}

// The panel starts collapsed; expanding is what renders the rows.
function expand(root) {
  root.querySelector('.fm-header button').click();
}

function rowFor(root, key) {
  return [...root.querySelectorAll('.fm-row')].find(
    (r) => r.querySelector('.fm-key')?.value === key
  );
}

const warned = (row) => {
  const el = row.querySelector('.fm-warn');
  return Boolean(el) && !el.classList.contains('hidden');
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('empty frontmatter value warning', () => {
  it('marks a row that has a key but no value', () => {
    const { root, panel } = mount();
    panel.setFrontmatter('title:\ndate: 2026-07-31\n');
    expand(root);

    expect(warned(rowFor(root, 'title'))).toBe(true);
    expect(warned(rowFor(root, 'date'))).toBe(false);
  });

  it('treats a whitespace-only value as empty', () => {
    const { root, panel } = mount();
    panel.setFrontmatter('title:   \n');
    expand(root);
    expect(warned(rowFor(root, 'title'))).toBe(true);
  });

  it('does not mark a row whose key is still blank', () => {
    // An unfinished row the user is typing, not a mistake to report.
    const { root, panel } = mount();
    panel.setFrontmatter('title: Post\n');
    expand(root);
    root.querySelector('.fm-add-prop').click();

    const blank = [...root.querySelectorAll('.fm-row')].find(
      (r) => r.querySelector('.fm-key')?.value === ''
    );
    expect(warned(blank)).toBe(false);
  });

  it('clears as soon as a value is typed, without rebuilding the row', () => {
    const { root, panel } = mount();
    panel.setFrontmatter('title:\n');
    expand(root);

    const row = rowFor(root, 'title');
    const marker = row.querySelector('.fm-warn');
    expect(warned(row)).toBe(true);

    const value = row.querySelector('.fm-value');
    value.value = 'My Post';
    value.dispatchEvent(new Event('input'));

    expect(warned(row)).toBe(false);
    // Same element — the row was not re-rendered, so the caret is undisturbed.
    expect(row.querySelector('.fm-warn')).toBe(marker);
  });

  it('appears when a value is cleared again', () => {
    const { root, panel } = mount();
    panel.setFrontmatter('title: Post\n');
    expand(root);

    const row = rowFor(root, 'title');
    const value = row.querySelector('.fm-value');
    value.value = '';
    value.dispatchEvent(new Event('input'));

    expect(warned(row)).toBe(true);
  });

  it('appears when a key is typed next to an empty value', () => {
    const { root, panel } = mount();
    panel.setFrontmatter('title: Post\n');
    expand(root);
    root.querySelector('.fm-add-prop').click();

    const blank = [...root.querySelectorAll('.fm-row')].find(
      (r) => r.querySelector('.fm-key')?.value === ''
    );
    const key = blank.querySelector('.fm-key');
    key.value = 'description';
    key.dispatchEvent(new Event('input'));

    expect(warned(blank)).toBe(true);
  });

  it('explains itself in a tooltip', () => {
    const { root, panel } = mount();
    panel.setFrontmatter('title:\n');
    expand(root);
    expect(rowFor(root, 'title').querySelector('.fm-warn').title).toMatch(/null/i);
  });
});
