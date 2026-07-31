const CONTENT_CANDIDATES = ['src/content', 'content', '_posts', 'posts', 'src/pages'];
const IMAGE_CANDIDATES = ['static', 'public', 'assets', 'src/assets', 'images'];

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
