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
