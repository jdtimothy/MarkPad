// Frontmatter templates. The three functions below are pure; storage lives
// further down and takes an injected store so tests never touch localStorage.

const TODAY_TOKEN = '{today}';

// Adds the template's keys that are missing, and changes nothing else. Every
// existing row keeps its value and its position, including { raw } rows, so
// applying a template can never lose work — which is what makes the control
// safe to press at any time.
export function applyTemplate(existingRows, templateRows) {
  const rows = existingRows ? [...existingRows] : [];
  const present = new Set(
    rows.filter((r) => r.raw === undefined).map((r) => r.key)
  );
  for (const row of templateRows) {
    if (present.has(row.key)) continue;
    present.add(row.key);
    rows.push({ key: row.key, value: row.value });
  }
  return rows;
}

// `today` is passed in rather than read here, so the function stays pure and
// its tests stay off the clock.
export function expandDefaults(templateRows, today) {
  return templateRows.map((row) => ({
    key: row.key,
    value: String(row.value ?? '').split(TODAY_TOKEN).join(today),
  }));
}

// The inverse capture: turn the panel's current rows into a template. A value
// that is exactly today's date becomes the token, because a template saved
// from a real post would otherwise bake in a date wrong for every future one.
export function templateFromRows(rows, today) {
  return rows
    .filter((r) => r.raw === undefined)
    .map((row) => ({
      key: row.key,
      value: row.value === today ? TODAY_TOKEN : row.value,
    }));
}
