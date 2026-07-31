const CONTENT_CANDIDATES = ['src/content', 'content', '_posts', 'posts', 'src/pages'];
// `src/assets` leads because a repo that has it is Astro-shaped, where images
// referenced from content go through the asset pipeline and `public/` is for
// files served verbatim. Everything after it keeps the generic ordering.
const IMAGE_CANDIDATES = ['src/assets', 'static', 'public', 'assets', 'images'];

const MARKDOWN_EXT = /\.(md|markdown)$/i;

// Directories a static-site generator publishes at the site root.
const PUBLISH_ROOTS = ['static', 'public'];

// Frontmatter keys that conventionally hold an image path. Deliberately
// "picture" rather than "pic", so an ordinary key like "topic" is not caught.
const IMAGE_KEY = /(hero|cover|image|img|thumb|banner|photo|picture|logo|avatar)/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;

// True when a frontmatter row should offer an image picker: either the key
// reads like an image field, or the value already points at an image. The
// value check is what rescues unconventional key names once they hold a path.
export function wantsImagePicker(key, value) {
  return IMAGE_KEY.test(key ?? '') || IMAGE_EXT.test(String(value ?? '').trim());
}

export function slugify(text) {
  const slug = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // drop the accents NFKD split off
    // Apostrophes vanish rather than becoming separators, so "What's New"
    // slugs to "whats-new" and not "what-s-new".
    .replace(/['‘’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'untitled';
}

// A post saved without a markdown extension is invisible to both the sidebar
// tree and most static-site generators, so give it one. The typed name is
// never discarded — a non-markdown extension is appended to, not replaced.
export function ensureMarkdownExtension(path) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (!name || MARKDOWN_EXT.test(name)) return path;
  return `${path}.md`;
}

export function newPostPath(contentDir, title) {
  const dir = contentDir.replace(/\/+$/, '');
  const file = `${slugify(title)}.md`;
  return dir ? `${dir}/${file}` : file;
}

export function uniquePath(path, existingPaths) {
  const taken = new Set(existingPaths);
  if (!taken.has(path)) return path;
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  const hasExt = dot > slash;
  const stem = hasExt ? path.slice(0, dot) : path;
  const ext = hasExt ? path.slice(dot) : '';
  let n = 1;
  while (taken.has(`${stem}-${n}${ext}`)) n += 1;
  return `${stem}-${n}${ext}`;
}

export function imageLink(postPath, imagePath, style) {
  if (style === 'site-absolute') {
    const root = PUBLISH_ROOTS.find((r) => imagePath.startsWith(`${r}/`));
    return `/${root ? imagePath.slice(root.length + 1) : imagePath}`;
  }

  const from = postPath.split('/').slice(0, -1);
  const to = imagePath.split('/');
  let shared = 0;
  while (shared < from.length && shared < to.length - 1 && from[shared] === to[shared]) shared += 1;
  const up = Array(from.length - shared).fill('..');
  return [...up, ...to.slice(shared)].join('/');
}

// The inverse of imageLink: given a markdown image URL, find the repo path.
// The site-absolute style deletes information (static/img/x.png becomes
// /img/x.png), so recovering the repo path means testing the known file list
// against each publish root.
export function repoPathForLink(postPath, src, knownPaths = []) {
  if (src.startsWith('/')) {
    const bare = src.slice(1);
    const known = new Set(knownPaths);
    if (known.has(bare)) return bare;
    for (const root of PUBLISH_ROOTS) {
      if (known.has(`${root}/${bare}`)) return `${root}/${bare}`;
    }
    return bare;
  }
  const parts = postPath.split('/').slice(0, -1);
  for (const segment of src.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.') parts.push(segment);
  }
  return parts.join('/');
}

export function guessDirs(paths) {
  const dirs = new Set();
  for (const path of paths) {
    const parts = path.split('/');
    parts.pop();
    let prefix = '';
    for (const part of parts) {
      prefix = prefix ? `${prefix}/${part}` : part;
      dirs.add(prefix);
    }
  }
  return {
    contentDir: CONTENT_CANDIDATES.find((c) => dirs.has(c)) ?? '',
    imageDir: IMAGE_CANDIDATES.find((c) => dirs.has(c)) ?? 'images',
  };
}
