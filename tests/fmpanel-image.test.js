// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createFrontmatterPanel } from '../src/renderer/fmpanel.js';

function mount({ onPickImage } = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const panel = createFrontmatterPanel(root, () => {}, { onPickImage });
  return { root, panel };
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

const visible = (button) => Boolean(button) && !button.classList.contains('hidden');

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('frontmatter image picker', () => {
  it('shows the picker only on image-shaped rows', () => {
    const { root, panel } = mount({ onPickImage: async () => null });
    panel.setFrontmatter('title: Post\nhero: \ndraft: false\n');
    expand(root);

    expect(visible(rowFor(root, 'hero').querySelector('.fm-image'))).toBe(true);
    expect(visible(rowFor(root, 'title').querySelector('.fm-image'))).toBe(false);
    expect(visible(rowFor(root, 'draft').querySelector('.fm-image'))).toBe(false);
  });

  it('shows the picker on an unconventional key whose value is an image path', () => {
    const { root, panel } = mount({ onPickImage: async () => null });
    panel.setFrontmatter('splash: static/img/x.png\n');
    expand(root);
    expect(visible(rowFor(root, 'splash').querySelector('.fm-image'))).toBe(true);
  });

  it('reveals the picker as soon as the key is typed, without a re-render', () => {
    const { root, panel } = mount({ onPickImage: async () => null });
    panel.setFrontmatter('title: Post\n');
    expand(root);

    const row = rowFor(root, 'title');
    const key = row.querySelector('.fm-key');
    const pick = row.querySelector('.fm-image');
    expect(visible(pick)).toBe(false);

    key.value = 'heroImage';
    key.dispatchEvent(new Event('input'));

    expect(visible(pick)).toBe(true);
    // Same element — the row was not rebuilt, so the caret is undisturbed.
    expect(row.querySelector('.fm-image')).toBe(pick);
  });

  it('writes the picked url into the row and the serialized frontmatter', async () => {
    const { root, panel } = mount({
      onPickImage: async () => ({ url: '/img/hero-1.png', name: 'hero.png' }),
    });
    panel.setFrontmatter('hero: \n');
    expand(root);

    const row = rowFor(root, 'hero');
    row.querySelector('.fm-image').click();
    await Promise.resolve();
    await Promise.resolve();

    expect(row.querySelector('.fm-value').value).toBe('/img/hero-1.png');
    expect(panel.getFrontmatter()).toContain('hero: /img/hero-1.png');
  });

  it('leaves the value alone when the pick is cancelled', async () => {
    const { root, panel } = mount({ onPickImage: async () => null });
    panel.setFrontmatter('hero: keep/me.png\n');
    expand(root);

    const row = rowFor(root, 'hero');
    row.querySelector('.fm-image').click();
    await Promise.resolve();
    await Promise.resolve();

    expect(row.querySelector('.fm-value').value).toBe('keep/me.png');
  });

  it('omits the picker entirely when no handler is supplied', () => {
    const { root, panel } = mount();
    panel.setFrontmatter('hero: x.png\n');
    expand(root);
    expect(rowFor(root, 'hero').querySelector('.fm-image')).toBeNull();
  });
});
