import { describe, it, expect } from 'vitest';
import {
  toggleInline,
  toggleHeading,
  toggleBlockquote,
  toggleList,
} from '../src/renderer/formatting.js';

describe('toggleInline', () => {
  it('wraps a selection in bold markers', () => {
    const r = toggleInline({ doc: 'hello world', from: 0, to: 5 }, '**');
    expect(r.doc).toBe('**hello** world');
    expect(r.from).toBe(2);
    expect(r.to).toBe(7);
  });

  it('unwraps when markers sit just outside the selection', () => {
    const r = toggleInline({ doc: '**hello** world', from: 2, to: 7 }, '**');
    expect(r.doc).toBe('hello world');
    expect(r.from).toBe(0);
    expect(r.to).toBe(5);
  });

  it('unwraps when markers are inside the selection', () => {
    const r = toggleInline({ doc: '**hello** world', from: 0, to: 9 }, '**');
    expect(r.doc).toBe('hello world');
    expect(r.from).toBe(0);
    expect(r.to).toBe(5);
  });

  it('inserts marker pair at cursor when selection is empty', () => {
    const r = toggleInline({ doc: 'ab', from: 1, to: 1 }, '**');
    expect(r.doc).toBe('a****b');
    expect(r.from).toBe(3);
    expect(r.to).toBe(3);
  });

  it('adds italic inside bold instead of stripping one star', () => {
    const r = toggleInline({ doc: '**bold**', from: 2, to: 6 }, '*');
    expect(r.doc).toBe('***bold***');
    expect(r.from).toBe(3);
    expect(r.to).toBe(7);
  });

  it('wraps with strikethrough and inline code markers', () => {
    expect(toggleInline({ doc: 'x', from: 0, to: 1 }, '~~').doc).toBe('~~x~~');
    expect(toggleInline({ doc: 'x', from: 0, to: 1 }, '`').doc).toBe('`x`');
  });
});

describe('toggleHeading', () => {
  it('adds a heading prefix to the current line', () => {
    const r = toggleHeading({ doc: 'hello', from: 3, to: 3 }, 2);
    expect(r.doc).toBe('## hello');
    expect(r.from).toBe(6);
  });

  it('removes the prefix when the line already has that level', () => {
    const r = toggleHeading({ doc: '## hello', from: 6, to: 6 }, 2);
    expect(r.doc).toBe('hello');
    expect(r.from).toBe(3);
  });

  it('replaces a different heading level', () => {
    const r = toggleHeading({ doc: '# hello', from: 0, to: 0 }, 3);
    expect(r.doc).toBe('### hello');
  });

  it('only affects the line containing the cursor', () => {
    const r = toggleHeading({ doc: 'one\ntwo', from: 5, to: 5 }, 1);
    expect(r.doc).toBe('one\n# two');
  });
});

describe('toggleBlockquote', () => {
  it('quotes every selected line', () => {
    const r = toggleBlockquote({ doc: 'a\nb', from: 0, to: 3 });
    expect(r.doc).toBe('> a\n> b');
  });

  it('unquotes when all lines are quoted', () => {
    const r = toggleBlockquote({ doc: '> a\n> b', from: 0, to: 7 });
    expect(r.doc).toBe('a\nb');
  });

  it('skips empty lines when quoting', () => {
    const r = toggleBlockquote({ doc: 'a\n\nb', from: 0, to: 4 });
    expect(r.doc).toBe('> a\n\n> b');
  });
});

describe('toggleList', () => {
  it('makes selected lines a bullet list', () => {
    const r = toggleList({ doc: 'a\nb', from: 0, to: 3 }, 'bullet');
    expect(r.doc).toBe('- a\n- b');
  });

  it('numbers ordered lists sequentially', () => {
    const r = toggleList({ doc: 'a\nb\nc', from: 0, to: 5 }, 'ordered');
    expect(r.doc).toBe('1. a\n2. b\n3. c');
  });

  it('makes a task list', () => {
    const r = toggleList({ doc: 'a', from: 0, to: 1 }, 'task');
    expect(r.doc).toBe('- [ ] a');
  });

  it('converts bullet list to ordered list', () => {
    const r = toggleList({ doc: '- a\n- b', from: 0, to: 7 }, 'ordered');
    expect(r.doc).toBe('1. a\n2. b');
  });

  it('toggles off when all lines already match', () => {
    const r = toggleList({ doc: '- a\n- b', from: 0, to: 7 }, 'bullet');
    expect(r.doc).toBe('a\nb');
  });

  it('does not treat a task list as a bullet list', () => {
    const r = toggleList({ doc: '- [ ] a', from: 0, to: 7 }, 'bullet');
    expect(r.doc).toBe('- a');
  });
});
