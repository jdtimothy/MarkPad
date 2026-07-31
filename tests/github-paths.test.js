import { describe, it, expect } from 'vitest';
import {
  slugify,
  newPostPath,
  uniquePath,
  guessDirs,
  imageLink,
  repoPathForLink,
} from '../src/renderer/github-paths.js';

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

describe('imageLink', () => {
  it('builds a site-absolute link stripped of the publish root', () => {
    expect(imageLink('content/posts/a.md', 'static/img/x.png', 'site-absolute'))
      .toBe('/img/x.png');
  });
  it('leaves a non-publish-root prefix intact when site-absolute', () => {
    expect(imageLink('content/a.md', 'assets/x.png', 'site-absolute'))
      .toBe('/assets/x.png');
  });
  it('builds a relative link from the post to the image', () => {
    expect(imageLink('content/posts/a.md', 'content/posts/img/x.png', 'relative'))
      .toBe('img/x.png');
  });
  it('walks up out of the post directory when needed', () => {
    expect(imageLink('content/posts/a.md', 'static/x.png', 'relative'))
      .toBe('../../static/x.png');
  });
  it('handles a post at the repo root', () => {
    expect(imageLink('a.md', 'images/x.png', 'relative')).toBe('images/x.png');
  });
});

describe('repoPathForLink', () => {
  it('reverses a relative link back to a repo path', () => {
    expect(repoPathForLink('content/posts/a.md', '../../static/x.png', []))
      .toBe('static/x.png');
  });
  it('resolves a same-directory link', () => {
    expect(repoPathForLink('content/a.md', 'img/x.png', [])).toBe('content/img/x.png');
  });
  it('restores the publish root a site-absolute link stripped', () => {
    expect(repoPathForLink('content/a.md', '/img/x.png', ['static/img/x.png']))
      .toBe('static/img/x.png');
  });
  it('leaves a site-absolute link alone when it already matches a real path', () => {
    expect(repoPathForLink('content/a.md', '/assets/x.png', ['assets/x.png']))
      .toBe('assets/x.png');
  });
  it('falls back to the bare path when nothing matches', () => {
    expect(repoPathForLink('content/a.md', '/img/x.png', [])).toBe('img/x.png');
  });
});
