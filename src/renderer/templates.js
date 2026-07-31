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

const STORAGE_KEY = 'markpad.templates';
const VERSION = 1;

function emptyData() {
  return { version: VERSION, seeded: false, templates: {} };
}

// Any failure here — storage disabled, corrupt JSON, a payload of the wrong
// shape — degrades to "no templates" rather than breaking the panel.
function read(store) {
  let parsed;
  try {
    parsed = JSON.parse(store.getItem(STORAGE_KEY) ?? '');
  } catch {
    return emptyData();
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    typeof parsed.templates !== 'object' ||
    parsed.templates === null ||
    Array.isArray(parsed.templates)
  ) {
    return emptyData();
  }
  return {
    version: parsed.version ?? VERSION,
    seeded: Boolean(parsed.seeded),
    templates: parsed.templates,
  };
}

function write(store, data) {
  try {
    store.setItem(STORAGE_KEY, JSON.stringify({ ...data, version: VERSION }));
  } catch {
    /* storage unavailable — the feature degrades, editing does not */
  }
}

// The seeded flag is why deleting Basic sticks. Keying off an empty list
// instead would resurrect it on the next launch.
export function ensureSeeded(store, basicRows) {
  const data = read(store);
  if (data.seeded) return;
  data.seeded = true;
  data.templates = { Basic: basicRows, ...data.templates };
  write(store, data);
}

export function listTemplates(store) {
  const { templates } = read(store);
  return Object.entries(templates).map(([name, rows]) => ({ name, rows }));
}

export function saveTemplate(store, name, rows) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed || !Array.isArray(rows) || rows.length === 0) return false;
  const data = read(store);
  data.templates[trimmed] = rows;
  write(store, data);
  return true;
}

export function deleteTemplate(store, name) {
  const data = read(store);
  if (!(name in data.templates)) return false;
  delete data.templates[name];
  write(store, data);
  return true;
}

// Rebuilds the object rather than deleting and re-adding, so a renamed
// template keeps its position in the list instead of jumping to the end.
export function renameTemplate(store, oldName, newName) {
  const trimmed = String(newName ?? '').trim();
  const data = read(store);
  if (!trimmed || !(oldName in data.templates) || trimmed in data.templates) return false;
  const renamed = {};
  for (const [name, rows] of Object.entries(data.templates)) {
    renamed[name === oldName ? trimmed : name] = rows;
  }
  data.templates = renamed;
  write(store, data);
  return true;
}
