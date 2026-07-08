// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from '../src/renderer/rendered-editor.js';

describe('htmlToMarkdown', () => {
  it('preserves simple rendered bullet lists as separate lines', () => {
    const root = document.createElement('div');
    root.innerHTML = '<ul><li>one</li><li>two</li><li>three</li></ul>';

    expect(htmlToMarkdown(root)).toBe('- one\n- two\n- three');
  });

  it('does not flatten block children inside list items', () => {
    const root = document.createElement('div');
    root.innerHTML = '<ol><li><div>one</div><div>two</div></li><li>three</li></ol>';

    expect(htmlToMarkdown(root)).toBe('1. one\n  two\n2. three');
  });

  it('preserves checked task list state', () => {
    const root = document.createElement('div');
    root.innerHTML = '<ul><li><input type="checkbox" checked> done</li><li><input type="checkbox"> todo</li></ul>';

    expect(htmlToMarkdown(root)).toBe('- [x] done\n- [ ] todo');
  });

  it('preserves br-created top-level lines before lists and quotes', () => {
    const root = document.createElement('div');
    root.innerHTML = 'test applecare<br>test apple<br>test applecare<ul><li>bullet</li><li>care</li><li>blu</li></ul><blockquote>happy days</blockquote>so there we are.';

    expect(htmlToMarkdown(root)).toBe('test applecare\n\ntest apple\n\ntest applecare\n\n- bullet\n- care\n- blu\n\n> happy days\n\nso there we are.');
  });

  it('does not flatten block children inside rendered wrapper divs', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div><div>test applecare</div><div>test apple</div><ul><li>bullet</li><li>care</li></ul><blockquote>happy days</blockquote><div>so there we are.</div></div>';

    expect(htmlToMarkdown(root)).toBe('test applecare\n\ntest apple\n\n- bullet\n- care\n\n> happy days\n\nso there we are.');
  });

  it('preserves file image URLs', () => {
    const root = document.createElement('div');
    root.innerHTML = '<img src="file:///C:/Users/joshu/Pictures/test.png" alt="test">';

    expect(htmlToMarkdown(root)).toBe('![test](file:///C:/Users/joshu/Pictures/test.png)');
  });

  it('preserves div-created lines inside rendered code blocks', () => {
    const root = document.createElement('div');
    root.innerHTML = '<pre><code><div>const a = 1;</div><div>const b = 2;</div></code></pre>';

    expect(htmlToMarkdown(root)).toBe('```\nconst a = 1;\nconst b = 2;\n```');
  });

  it('preserves br-created lines inside rendered code blocks', () => {
    const root = document.createElement('div');
    root.innerHTML = '<pre><code>const a = 1;<br>const b = 2;</code></pre>';

    expect(htmlToMarkdown(root)).toBe('```\nconst a = 1;\nconst b = 2;\n```');
  });
});
