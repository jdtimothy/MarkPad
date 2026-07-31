const MARKDOWN = /\.(md|markdown)$/i;

export function buildTree(entries) {
  const root = { children: new Map() };

  for (const item of entries) {
    if (item.type !== 'blob' || !MARKDOWN.test(item.path)) continue;
    const parts = item.path.split('/');
    const fileName = parts.pop();
    let node = root;
    let prefix = '';
    for (const part of parts) {
      prefix = prefix ? `${prefix}/${part}` : part;
      if (!node.children.has(part)) {
        node.children.set(part, { type: 'dir', name: part, path: prefix, children: new Map() });
      }
      node = node.children.get(part);
    }
    node.children.set(fileName, {
      type: 'file',
      name: fileName,
      path: item.path,
      sha: item.sha,
    });
  }

  return toArray(root);
}

function toArray(node) {
  const list = [...node.children.values()].map((child) =>
    child.type === 'dir'
      ? { type: 'dir', name: child.name, path: child.path, children: toArray(child) }
      : child
  );
  list.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
  return list;
}
