import { describe, it, expect } from 'vitest';
import { applyTemplate, expandDefaults, templateFromRows } from '../src/renderer/templates.js';

const row = (key, value) => ({ key, value });

describe('applyTemplate', () => {
  it('adds only the keys that are missing', () => {
    const result = applyTemplate(
      [row('title', 'My Post')],
      [row('title', ''), row('description', ''), row('tags', '[]')]
    );
    expect(result).toEqual([
      row('title', 'My Post'),
      row('description', ''),
      row('tags', '[]'),
    ]);
  });

  it('never changes a value the user already set', () => {
    const result = applyTemplate([row('title', 'Mine')], [row('title', 'Default')]);
    expect(result).toEqual([row('title', 'Mine')]);
  });

  it('keeps existing rows in their original order', () => {
    const result = applyTemplate(
      [row('z', '1'), row('a', '2')],
      [row('a', ''), row('b', '')]
    );
    expect(result.map((r) => r.key)).toEqual(['z', 'a', 'b']);
  });

  it('preserves raw rows untouched', () => {
    const raw = { raw: 'nested:\n  a: 1' };
    const result = applyTemplate([raw, row('title', 'x')], [row('tags', '[]')]);
    expect(result[0]).toBe(raw);
    expect(result.map((r) => r.key)).toEqual([undefined, 'title', 'tags']);
  });

  it('treats keys as case-sensitive, matching YAML', () => {
    const result = applyTemplate([row('pubdate', '2026-01-01')], [row('pubDate', '')]);
    expect(result.map((r) => r.key)).toEqual(['pubdate', 'pubDate']);
  });

  it('is a no-op applied twice', () => {
    const template = [row('title', ''), row('tags', '[]')];
    const once = applyTemplate([row('title', 'Mine')], template);
    expect(applyTemplate(once, template)).toEqual(once);
  });

  it('creates the rows when the document has no frontmatter', () => {
    expect(applyTemplate(null, [row('title', '')])).toEqual([row('title', '')]);
  });

  it('does not mutate the array it was given', () => {
    const existing = [row('title', 'x')];
    applyTemplate(existing, [row('tags', '[]')]);
    expect(existing).toHaveLength(1);
  });

  it('ignores a duplicate key inside the template itself', () => {
    const result = applyTemplate([], [row('tags', '[]'), row('tags', 'other')]);
    expect(result).toEqual([row('tags', '[]')]);
  });

  it('handles an empty template', () => {
    expect(applyTemplate([row('title', 'x')], [])).toEqual([row('title', 'x')]);
  });
});

describe('expandDefaults', () => {
  it('replaces the today token', () => {
    expect(expandDefaults([row('date', '{today}')], '2026-07-31'))
      .toEqual([row('date', '2026-07-31')]);
  });

  it('leaves other values alone', () => {
    expect(expandDefaults([row('tags', '[]')], '2026-07-31'))
      .toEqual([row('tags', '[]')]);
  });

  it('replaces the token inside a longer value', () => {
    expect(expandDefaults([row('slug', 'archive/{today}.md')], '2026-07-31'))
      .toEqual([row('slug', 'archive/2026-07-31.md')]);
  });

  it('replaces the token in every row and more than once per value', () => {
    expect(expandDefaults([row('a', '{today}'), row('b', '{today}/{today}')], '2026-07-31'))
      .toEqual([row('a', '2026-07-31'), row('b', '2026-07-31/2026-07-31')]);
  });

  it('does not mutate the template it was given', () => {
    const template = [row('date', '{today}')];
    expandDefaults(template, '2026-07-31');
    expect(template[0].value).toBe('{today}');
  });
});

describe('templateFromRows', () => {
  it('stores a value equal to today as the token', () => {
    expect(templateFromRows([row('date', '2026-07-31')], '2026-07-31'))
      .toEqual([row('date', '{today}')]);
  });

  it('leaves a different date literal', () => {
    expect(templateFromRows([row('date', '2020-01-01')], '2026-07-31'))
      .toEqual([row('date', '2020-01-01')]);
  });

  it('only substitutes an exact match, not a date inside a longer value', () => {
    expect(templateFromRows([row('slug', 'post-2026-07-31')], '2026-07-31'))
      .toEqual([row('slug', 'post-2026-07-31')]);
  });

  it('drops raw rows, which mean nothing as a default', () => {
    expect(templateFromRows([{ raw: 'nested:' }, row('title', 'x')], '2026-07-31'))
      .toEqual([row('title', 'x')]);
  });

  it('keeps empty values, which are a legitimate default to fill in', () => {
    expect(templateFromRows([row('title', '')], '2026-07-31'))
      .toEqual([row('title', '')]);
  });
});
