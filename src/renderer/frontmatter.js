// Pure frontmatter handling. Flat `key: value` pairs only; anything else is
// preserved verbatim as a { raw } row so unknown YAML is never destroyed.
// No YAML library by design (see spec).

export function splitFrontmatter(doc) {
  const lines = doc.split('\n');
  if (lines[0] !== '---') return { fm: null, body: doc };
  const endIdx = lines.indexOf('---', 1);
  if (endIdx === -1) return { fm: null, body: doc };
  const fm = lines.slice(1, endIdx).join('\n');
  let body = lines.slice(endIdx + 1).join('\n');
  if (body.startsWith('\n')) body = body.slice(1); // absorb one separator line
  return { fm, body };
}

const PAIR_RE = /^([A-Za-z0-9_-]+):\s?(.*)$/;

export function parseFrontmatter(fm) {
  if (!fm) return [];
  return fm
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const m = line.match(PAIR_RE);
      return m ? { key: m[1], value: m[2] } : { raw: line };
    });
}

export function serializeFrontmatter(rows) {
  return rows
    .map((r) => (r.raw !== undefined ? r.raw : `${r.key}: ${r.value}`.trimEnd()))
    .join('\n');
}

export function joinDoc(fm, body) {
  if (fm === null) return body;
  return `---\n${fm}\n---\n\n${body}`;
}

export function defaultFrontmatter(today) {
  return [
    { key: 'title', value: '' },
    { key: 'date', value: today },
    { key: 'tags', value: '[]' },
  ];
}
