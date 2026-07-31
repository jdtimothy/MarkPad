import { describe, it, expect } from 'vitest';
import {
  slugify,
  newPostPath,
  uniquePath,
  guessDirs,
  imageLink,
  repoPathForLink,
  wantsImagePicker,
  ensureMarkdownExtension,
  sanitizeBranchName,
  safeAssetName,
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
  it('prefers src/assets over public on an Astro-shaped repo', () => {
    // Astro serves public/ verbatim; content images belong in src/assets so
    // the asset pipeline processes them.
    expect(guessDirs([
      'src/assets/blog/.gitkeep',
      'public/favicon.svg',
      'src/content/blog/a.md',
    ]).imageDir).toBe('src/assets');
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
  it('decodes the percent-encoding markdown-it puts in the rendered src', () => {
    expect(repoPathForLink('content/a.md', 'img/My%20File.png', []))
      .toBe('content/img/My File.png');
  });
  it('survives a stray percent that is not an escape', () => {
    expect(repoPathForLink('content/a.md', 'img/100%.png', []))
      .toBe('content/img/100%.png');
  });
});

describe('safeAssetName', () => {
  it('replaces the spaces that would break the markdown link', () => {
    // Both of these came off a real camera roll and broke a published post:
    // a space in the destination stops it being a link at all.
    expect(safeAssetName('Meadow 2 copy_01_00_11_06.jpg'))
      .toBe('meadow-2-copy_01_00_11_06.jpg');
    expect(safeAssetName('Screenshot_20260722_200610_Shop Samsung.jpg'))
      .toBe('screenshot_20260722_200610_shop-samsung.jpg');
  });

  it('keeps underscores, digits and hyphens', () => {
    expect(safeAssetName('a_b-c1.png')).toBe('a_b-c1.png');
  });

  it('lowercases so a case-insensitive desktop cannot disagree with the server', () => {
    expect(safeAssetName('Photo.JPG')).toBe('photo.jpg');
  });

  it('strips punctuation and accents', () => {
    expect(safeAssetName("René's café (final).jpeg")).toBe('renes-cafe-final.jpeg');
  });

  it('collapses runs and trims separators', () => {
    expect(safeAssetName('  too   many   gaps .png')).toBe('too-many-gaps.png');
  });

  it('handles a name with no extension', () => {
    expect(safeAssetName('My Screenshot')).toBe('my-screenshot');
  });

  it('does not treat a leading dot as an extension', () => {
    expect(safeAssetName('.hidden')).toBe('hidden');
  });

  it('falls back when the stem has nothing usable', () => {
    expect(safeAssetName('!!!.png')).toBe('image.png');
    expect(safeAssetName('')).toBe('image');
  });
});

describe('sanitizeBranchName', () => {
  it('keeps a already-valid name untouched', () => {
    expect(sanitizeBranchName('post/my-thing')).toBe('post/my-thing');
  });

  it('preserves case, because branch names are case sensitive', () => {
    expect(sanitizeBranchName('Post/MyThing')).toBe('Post/MyThing');
  });

  it('turns whitespace into hyphens', () => {
    expect(sanitizeBranchName('my new branch')).toBe('my-new-branch');
    expect(sanitizeBranchName('  padded  ')).toBe('padded');
  });

  it('strips characters git forbids in a ref', () => {
    expect(sanitizeBranchName('bad~name^with:junk?*[]\\')).toBe('bad-name-with-junk');
  });

  it('collapses repeated and edge slashes', () => {
    expect(sanitizeBranchName('feat//double')).toBe('feat/double');
    expect(sanitizeBranchName('/leading/')).toBe('leading');
  });

  it('refuses the sequences git rejects', () => {
    expect(sanitizeBranchName('a..b')).toBe('a.b');
    expect(sanitizeBranchName('a@{b')).toBe('a-b');
  });

  it('trims leading hyphens and dots and a trailing .lock', () => {
    expect(sanitizeBranchName('-leading')).toBe('leading');
    expect(sanitizeBranchName('.dotted')).toBe('dotted');
    expect(sanitizeBranchName('mybranch.lock')).toBe('mybranch');
  });

  it('returns an empty string when nothing usable is left', () => {
    expect(sanitizeBranchName('~~~')).toBe('');
    expect(sanitizeBranchName('   ')).toBe('');
    expect(sanitizeBranchName(undefined)).toBe('');
  });
});

describe('ensureMarkdownExtension', () => {
  it('leaves a markdown path alone', () => {
    expect(ensureMarkdownExtension('content/posts/hello.md')).toBe('content/posts/hello.md');
    expect(ensureMarkdownExtension('notes.markdown')).toBe('notes.markdown');
  });

  it('accepts any capitalisation of the extension', () => {
    expect(ensureMarkdownExtension('A.MD')).toBe('A.MD');
    expect(ensureMarkdownExtension('b.MarkDown')).toBe('b.MarkDown');
  });

  it('appends .md when the extension is missing', () => {
    expect(ensureMarkdownExtension('Test2')).toBe('Test2.md');
    expect(ensureMarkdownExtension('src/content/blog/Test2')).toBe('src/content/blog/Test2.md');
  });

  it('appends rather than replacing a non-markdown extension', () => {
    // Never discard what the author typed — "post.txt" stays visible.
    expect(ensureMarkdownExtension('post.txt')).toBe('post.txt.md');
  });

  it('is not fooled by a dot in a directory name', () => {
    expect(ensureMarkdownExtension('v1.2/notes')).toBe('v1.2/notes.md');
  });

  it('leaves a path with no filename untouched', () => {
    expect(ensureMarkdownExtension('content/')).toBe('content/');
    expect(ensureMarkdownExtension('')).toBe('');
  });
});

describe('wantsImagePicker', () => {
  it('matches the common image key names', () => {
    for (const key of [
      'hero', 'cover', 'image', 'thumbnail', 'banner',
      'photo', 'picture', 'logo', 'avatar',
    ]) {
      expect(wantsImagePicker(key, '')).toBe(true);
    }
  });

  it('matches decorated and camelCased variants', () => {
    for (const key of ['heroImage', 'featured_image', 'og_image', 'cover-img', 'postThumbnail']) {
      expect(wantsImagePicker(key, '')).toBe(true);
    }
  });

  it('ignores ordinary frontmatter keys', () => {
    for (const key of ['title', 'date', 'draft', 'tags', 'description', 'summary', 'author', 'slug']) {
      expect(wantsImagePicker(key, '')).toBe(false);
    }
  });

  it('does not treat "topic" as an image key', () => {
    // Guards the key pattern against matching a bare "pic" substring.
    expect(wantsImagePicker('topic', '')).toBe(false);
  });

  it('matches any key whose value already looks like an image path', () => {
    expect(wantsImagePicker('postPic', 'static/img/x.png')).toBe(true);
    expect(wantsImagePicker('splash', '/img/a.jpg')).toBe(true);
    expect(wantsImagePicker('whatever', 'x.webp')).toBe(true);
  });

  it('matches image extensions case-insensitively and ignores surrounding space', () => {
    expect(wantsImagePicker('splash', '  cover.SVG  ')).toBe(true);
  });

  it('ignores values that are not image paths', () => {
    expect(wantsImagePicker('title', 'My First Post')).toBe(false);
    expect(wantsImagePicker('draft', 'true')).toBe(false);
    expect(wantsImagePicker('date', '2026-07-31')).toBe(false);
  });

  it('tolerates missing key or value', () => {
    expect(wantsImagePicker(undefined, undefined)).toBe(false);
    expect(wantsImagePicker('', '')).toBe(false);
    expect(wantsImagePicker('hero', undefined)).toBe(true);
  });
});
