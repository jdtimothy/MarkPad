// All functions operate on a plain state object { doc, from, to } and
// return the same shape. They never touch CodeMirror directly.

export function toggleInline({ doc, from, to }, marker) {
  const len = marker.length;
  const selected = doc.slice(from, to);

  // Markers inside the selection: unwrap.
  if (
    selected.length >= 2 * len &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    const inner = selected.slice(len, selected.length - len);
    return { doc: doc.slice(0, from) + inner + doc.slice(to), from, to: to - 2 * len };
  }

  // Markers just outside the selection: unwrap — unless this is the italic
  // marker sitting on the inner star of a bold pair.
  const before = doc.slice(Math.max(0, from - len), from);
  const after = doc.slice(to, to + len);
  const boldCollision =
    marker === '*' &&
    doc.slice(Math.max(0, from - 2), from) === '**' &&
    doc.slice(to, to + 2) === '**';
  if (before === marker && after === marker && !boldCollision) {
    return {
      doc: doc.slice(0, from - len) + selected + doc.slice(to + len),
      from: from - len,
      to: to - len,
    };
  }

  // Otherwise wrap.
  return {
    doc: doc.slice(0, from) + marker + selected + marker + doc.slice(to),
    from: from + len,
    to: to + len,
  };
}

// --- line helpers -----------------------------------------------------------

function lineRange(doc, from, to) {
  const start = doc.lastIndexOf('\n', from - 1) + 1;
  let end = doc.indexOf('\n', to);
  if (end === -1) end = doc.length;
  return { start, end };
}

// Map a position through a list of prefix edits [{ at, delta }] (ascending).
// A position inside a removed prefix clamps to the edit point.
function mapPos(pos, edits) {
  let mapped = pos;
  for (const { at, delta } of edits) {
    if (pos > at) mapped += Math.max(delta, at - pos);
  }
  return mapped;
}

// Transform each selected line with `fn(line) -> newLine`, rebuild the doc,
// and map the selection through the edits.
function transformLines({ doc, from, to }, fn) {
  const { start, end } = lineRange(doc, from, to);
  const lines = doc.slice(start, end).split('\n');
  const edits = [];
  let lineStart = start;
  const newLines = lines.map((line) => {
    const newLine = fn(line);
    if (newLine.length !== line.length) {
      edits.push({ at: lineStart, delta: newLine.length - line.length });
    }
    lineStart += line.length + 1;
    return newLine;
  });
  const newDoc = doc.slice(0, start) + newLines.join('\n') + doc.slice(end);
  return { doc: newDoc, from: mapPos(from, edits), to: mapPos(to, edits) };
}

// --- block styles ------------------------------------------------------------

const HEADING_RE = /^(#{1,6}) /;

export function toggleHeading(state, level) {
  const prefix = '#'.repeat(level) + ' ';
  return transformLines(state, (line) => {
    const m = line.match(HEADING_RE);
    if (m && m[1].length === level) return line.slice(m[0].length);
    if (m) return prefix + line.slice(m[0].length);
    return prefix + line;
  });
}

export function toggleBlockquote(state) {
  const { doc, from, to } = state;
  const { start, end } = lineRange(doc, from, to);
  const lines = doc.slice(start, end).split('\n');
  const allQuoted = lines.every((l) => l === '' || l.startsWith('> '));
  return transformLines(state, (line) => {
    if (line === '') return line;
    return allQuoted ? line.slice(2) : '> ' + line;
  });
}

const LIST_PATTERNS = {
  task: /^- \[[ xX]\] /,
  bullet: /^- (?!\[[ xX]\] )/,
  ordered: /^\d+\. /,
};
const ANY_LIST_RE = /^(?:- \[[ xX]\] |- |\d+\. )/;

export function toggleList(state, type) {
  const { doc, from, to } = state;
  const { start, end } = lineRange(doc, from, to);
  const lines = doc.slice(start, end).split('\n');
  const pattern = LIST_PATTERNS[type];
  const nonEmpty = lines.filter((l) => l !== '');
  const allMarked = nonEmpty.length > 0 && nonEmpty.every((l) => pattern.test(l));
  let n = 1;
  return transformLines(state, (line) => {
    if (line === '') return line;
    if (allMarked) return line.replace(pattern, '');
    const bare = line.replace(ANY_LIST_RE, '');
    if (type === 'bullet') return '- ' + bare;
    if (type === 'task') return '- [ ] ' + bare;
    return `${n++}. ` + bare;
  });
}

// --- inserts -----------------------------------------------------------------

export function insertLink({ doc, from, to }, url) {
  const text = doc.slice(from, to) || 'link text';
  const md = `[${text}](${url})`;
  return {
    doc: doc.slice(0, from) + md + doc.slice(to),
    from: from + 1,
    to: from + 1 + text.length,
  };
}

export function insertImage({ doc, from, to }, url) {
  const alt = doc.slice(from, to) || 'alt';
  const md = `![${alt}](${url})`;
  return {
    doc: doc.slice(0, from) + md + doc.slice(to),
    from: from + 2,
    to: from + 2 + alt.length,
  };
}

const FENCE = '```';

export function insertCodeBlock({ doc, from, to }) {
  const selected = doc.slice(from, to);
  const atLineStart = from === 0 || doc[from - 1] === '\n';
  const lead = atLineStart ? '' : '\n';
  const atLineEnd = to === doc.length || doc[to] === '\n';
  const trail = atLineEnd ? '' : '\n';
  const block = `${lead}${FENCE}\n${selected}\n${FENCE}${trail}`;
  const contentStart = from + lead.length + FENCE.length + 1;
  return {
    doc: doc.slice(0, from) + block + doc.slice(to),
    from: contentStart,
    to: contentStart + selected.length,
  };
}

const TABLE =
  '| Column 1 | Column 2 | Column 3 |\n' +
  '| -------- | -------- | -------- |\n' +
  '|          |          |          |\n';

export function insertTable({ doc, from, to }) {
  const atLineStart = from === 0 || doc[from - 1] === '\n';
  const lead = atLineStart ? '' : '\n';
  const insert = lead + TABLE;
  const cursor = from + lead.length + 2; // first header cell
  return { doc: doc.slice(0, from) + insert + doc.slice(to), from: cursor, to: cursor };
}

export function insertHorizontalRule({ doc, from, to }) {
  // A blank line before --- is required; otherwise markdown reads the
  // previous line + --- as a setext heading.
  const atDocStart = from === 0;
  const lead = atDocStart ? '' : '\n\n';
  const insert = lead + '---\n\n';
  const cursor = from + insert.length;
  return { doc: doc.slice(0, from) + insert + doc.slice(to), from: cursor, to: cursor };
}
