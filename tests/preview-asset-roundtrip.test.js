// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { renderPreview, setAssetResolver } from '../src/renderer/preview.js';
import { htmlToMarkdown } from '../src/renderer/rendered-editor.js';

const DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

afterEach(() => setAssetResolver(null));

describe('asset resolution round trip', () => {
  it('renders the resolved image but serializes the original link back', async () => {
    setAssetResolver(async () => DATA_URL);
    const container = document.createElement('div');

    await renderPreview(container, '![hero](../../static/img/x.png)');

    // The preview shows the real bytes...
    expect(container.querySelector('img').getAttribute('src')).toBe(DATA_URL);
    // ...but the document must keep the repo link, not the data URL.
    expect(htmlToMarkdown(container)).toBe('![hero](../../static/img/x.png)');
  });

  it('survives repeated render/serialize cycles', async () => {
    setAssetResolver(async () => DATA_URL);
    const container = document.createElement('div');

    let doc = '![hero](/img/x.png)';
    for (let i = 0; i < 3; i += 1) {
      await renderPreview(container, doc);
      doc = htmlToMarkdown(container);
    }
    expect(doc).toBe('![hero](/img/x.png)');
  });

  it('leaves images alone when no resolver is installed', async () => {
    const container = document.createElement('div');
    await renderPreview(container, '![hero](/img/x.png)');
    expect(container.querySelector('img').getAttribute('src')).toBe('/img/x.png');
    expect(htmlToMarkdown(container)).toBe('![hero](/img/x.png)');
  });

  it('keeps an unresolved image as written', async () => {
    setAssetResolver(async () => null);
    const container = document.createElement('div');
    await renderPreview(container, '![hero](/img/missing.png)');
    expect(htmlToMarkdown(container)).toBe('![hero](/img/missing.png)');
  });

  it('does not touch absolute and data sources', async () => {
    setAssetResolver(async () => DATA_URL);
    const container = document.createElement('div');
    await renderPreview(container, '![a](https://example.com/x.png)');
    expect(htmlToMarkdown(container)).toBe('![a](https://example.com/x.png)');
  });

  it('serializes a newly inserted image from its own src', () => {
    // An image inserted by the toolbar while in rendered mode has no
    // resolver bookkeeping on it yet.
    const container = document.createElement('div');
    container.innerHTML = '<p><img src="../static/new.png" alt="new"></p>';
    expect(htmlToMarkdown(container)).toBe('![new](../static/new.png)');
  });
});
