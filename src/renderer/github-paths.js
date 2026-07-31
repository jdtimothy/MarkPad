const CONTENT_CANDIDATES = ['src/content', 'content', '_posts', 'posts', 'src/pages'];
const IMAGE_CANDIDATES = ['static', 'public', 'assets', 'src/assets', 'images'];

// Directories a static-site generator publishes at the site root.
const PUBLISH_ROOTS = ['static', 'public'];

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
