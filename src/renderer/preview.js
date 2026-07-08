import mermaid from 'mermaid';
import DOMPurify from 'dompurify';
import { renderMarkdown } from './markdown.js';

mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });

let mermaidCounter = 0;

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
}
