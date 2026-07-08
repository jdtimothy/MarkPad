import { describe, it, expect } from 'vitest';
import {
  splitFrontmatter,
  parseFrontmatter,
  serializeFrontmatter,
  joinDoc,
  defaultFrontmatter,
} from '../src/renderer/frontmatter.js';

describe('splitFrontmatter', () => {
  it('returns null fm when the doc has none', () => {
    expect(splitFrontmatter('# hi')).toEqual({ fm: null, body: '# hi' });
  });

  it('splits fm and body', () => {
    expect(splitFrontmatter('---\ntitle: x\n---\n\n# hi')).toEqual({
      fm: 'title: x',
      body: '# hi',
    });
  });

  it('treats an unclosed fence as plain body', () => {
    expect(splitFrontmatter('---\ntitle: x')).toEqual({
      fm: null,
      body: '---\ntitle: x',
    });
  });

  it('does not require a blank line after the block', () => {
    expect(splitFrontmatter('---\na: 1\n---\nbody')).toEqual({
      fm: 'a: 1',
      body: 'body',
    });
  });
});

describe('parseFrontmatter', () => {
  it('parses flat key-value pairs', () => {
    expect(parseFrontmatter('title: x\ndate: 2026-07-07')).toEqual([
      { key: 'title', value: 'x' },
      { key: 'date', value: '2026-07-07' },
    ]);
  });

  it('preserves non-pair lines as raw rows in order', () => {
    expect(parseFrontmatter('tags:\n  - a\n# comment')).toEqual([
      { key: 'tags', value: '' },
      { raw: '  - a' },
      { raw: '# comment' },
    ]);
  });
});

describe('serializeFrontmatter', () => {
  it('round-trips parse -> serialize including raw rows', () => {
    const src = 'title: x\ntags:\n  - a';
    expect(serializeFrontmatter(parseFrontmatter(src))).toBe(src);
  });
});

describe('joinDoc', () => {
  it('returns the body alone when fm is null', () => {
    expect(joinDoc(null, '# hi')).toBe('# hi');
  });

  it('joins with fences and a blank separator line', () => {
    expect(joinDoc('a: 1', 'body')).toBe('---\na: 1\n---\n\nbody');
  });

  it('split(join(fm, body)) round-trips', () => {
    expect(splitFrontmatter(joinDoc('a: 1', 'body'))).toEqual({
      fm: 'a: 1',
      body: 'body',
    });
  });
});

describe('defaultFrontmatter', () => {
  it('provides a title/date/tags template', () => {
    expect(defaultFrontmatter('2026-07-07')).toEqual([
      { key: 'title', value: '' },
      { key: 'date', value: '2026-07-07' },
      { key: 'tags', value: '[]' },
    ]);
  });
});
