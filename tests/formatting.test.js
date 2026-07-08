import { describe, it, expect } from 'vitest';
import { toggleInline } from '../src/renderer/formatting.js';

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
