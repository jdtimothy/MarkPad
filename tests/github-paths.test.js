import { describe, it, expect } from 'vitest';
import { slugify, newPostPath, uniquePath, guessDirs } from '../src/renderer/github-paths.js';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('My First Post')).toBe('my-first-post');
  });
  it('strips punctuation and collapses separators', () => {
    expect(slugify("What's New?  Really -- lots!")).toBe('whats-new-really-lots');
  });
  it('trims leading and trailing hyphens', () => {
    expect(slugify('  --hello--  ')).toBe('hello');
  });
  it('falls back to "untitled" when nothing survives', () => {
    expect(slugify('!!!')).toBe('untitled');
  });
});

describe('newPostPath', () => {
  it('joins the content dir and the slug', () => {
    expect(newPostPath('content/posts', 'Hello World')).toBe('content/posts/hello-world.md');
  });
  it('tolerates a trailing slash on the dir', () => {
    expect(newPostPath('content/posts/', 'Hi')).toBe('content/posts/hi.md');
  });
  it('handles an empty content dir', () => {
    expect(newPostPath('', 'Hi')).toBe('hi.md');
  });
});

describe('uniquePath', () => {
  it('returns the path unchanged when it is free', () => {
    expect(uniquePath('static/a.png', ['static/b.png'])).toBe('static/a.png');
  });
  it('suffixes before the extension on collision', () => {
    expect(uniquePath('static/a.png', ['static/a.png'])).toBe('static/a-1.png');
  });
  it('keeps counting past existing suffixes', () => {
    expect(uniquePath('static/a.png', ['static/a.png', 'static/a-1.png'])).toBe('static/a-2.png');
  });
  it('handles names with no extension', () => {
    expect(uniquePath('static/README', ['static/README'])).toBe('static/README-1');
  });
});

describe('guessDirs', () => {
  it('prefers src/content over content when both exist', () => {
    expect(guessDirs(['src/content/a.md', 'content/b.md']).contentDir).toBe('src/content');
  });
  it('finds a posts directory', () => {
    expect(guessDirs(['posts/a.md']).contentDir).toBe('posts');
  });
  it('picks an image directory from known candidates', () => {
    expect(guessDirs(['static/img/logo.png', 'content/a.md']).imageDir).toBe('static');
  });
  it('falls back to repo root and an images folder when nothing matches', () => {
    expect(guessDirs(['a.md'])).toEqual({ contentDir: '', imageDir: 'images' });
  });
});
