import mermaid from 'mermaid';
import DOMPurify from 'dompurify';
import { renderMarkdown } from './markdown.js';

mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });

let mermaidCounter = 0;
let resolveAsset = null;

// index.js installs a resolver when a repo document is open, so that both
// staged (uncommitted) and already-committed images render in the preview.
export function setAssetResolver(fn) {
  resolveAsset = fn;
}

export async function renderPreview(container, source) {
  container.innerHTML = renderMarkdown(source);
  const blocks = container.querySelectorAll('pre > code.language-mermaid');
  for (const code of blocks) {
    const div = document.createElement('div');
    const src = code.textContent;
    code.parentElement.replaceWith(div);
    try {
      const { svg } = await mermaid.render(`mermaid-${mermaidCounter++}`, src);
      div.innerHTML = DOMPurify.sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
      });
    } catch (err) {
      div.className = 'preview-error';
      div.textContent = `Mermaid error: ${err.message}`;
    }
  }

  if (resolveAsset) {
    for (const img of container.querySelectorAll('img')) {
      const src = img.getAttribute('src');
      if (!src || /^(https?:|data:|file:)/i.test(src)) continue;
      const resolved = await resolveAsset(src);
      if (!resolved) continue;
      // The preview pane is editable and serializes straight back to
      // markdown, so the link the document should keep is recorded here.
      // Without it, htmlToMarkdown would write the data URL into the file.
      img.dataset.mdSrc = src;
      img.setAttribute('src', resolved);
    }
  }
}
