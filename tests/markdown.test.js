// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../src/renderer/markdown.js';

describe('renderMarkdown', () => {
  it('renders GFM tables', () => {
    const html = renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |');
    expect(html).toContain('<table>');
  });

  it('renders strikethrough', () => {
    expect(renderMarkdown('~~gone~~')).toContain('<s>');
  });

  it('renders task list checkboxes', () => {
    const html = renderMarkdown('- [x] done\n- [ ] todo');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked');
  });

  it('renders local file images', () => {
    const html = renderMarkdown('![alt](file:///C:/Users/joshu/Downloads/IMA56EMMUKhw4.png)');
    expect(html).toContain('<img');
    expect(html).toContain('src="file:///C:/Users/joshu/Downloads/IMA56EMMUKhw4.png"');
  });

  it('autolinks bare URLs', () => {
    expect(renderMarkdown('see https://example.com today')).toContain('<a href="https://example.com"');
  });

  it('renders footnotes', () => {
    const html = renderMarkdown('text[^1]\n\n[^1]: the note');
    expect(html).toContain('footnote');
  });

  it('renders inline math with KaTeX', () => {
    expect(renderMarkdown('$x^2$')).toContain('katex');
  });

  it('strips script tags', () => {
    const html = renderMarkdown('hello <script>alert(1)</script>');
    expect(html).not.toContain('<script');
  });

  it('strips event handler attributes', () => {
    const html = renderMarkdown('<img src="x.png" onerror="alert(1)">');
    expect(html).not.toContain('onerror');
  });

  it('leaves mermaid blocks as language-mermaid code', () => {
    const html = renderMarkdown('```mermaid\ngraph TD; A-->B;\n```');
    expect(html).toContain('language-mermaid');
  });

  it('preserves KaTeX MathML annotation structure', () => {
    const html = renderMarkdown('$x^2$');
    expect(html).toContain('<annotation encoding="application/x-tex"');
  });

  it('strips javascript: URLs from links', () => {
    const html = renderMarkdown('[click](javascript:alert(1))');
    expect(html).not.toContain('href="javascript:');
  });

  it('strips iframe tags', () => {
    const html = renderMarkdown('<iframe src="https://evil.example"></iframe>');
    expect(html).not.toContain('<iframe');
  });
});
