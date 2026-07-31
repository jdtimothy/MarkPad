# Frontmatter Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user apply a named, user-defined template that fills in a document's frontmatter keys, and warn when a frontmatter row has a key but no value.

**Architecture:** A new renderer module `templates.js` holds three pure functions (merge, token expansion, row capture) plus thin `localStorage`-backed storage that takes an injected store. `frontmatter.js` is untouched and stays pure. `fmpanel.js` grows a template bar above its existing header and an in-place warning marker per row. The two features are independent: the warning works with no template defined, and templates work with the warning removed.

**Tech Stack:** Plain ES-module renderer bundled by esbuild, Vitest 4 (jsdom opt-in per file with `// @vitest-environment jsdom`). No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-07-31-frontmatter-templates-design.md`

## Global Constraints

- **No new npm dependencies.**
- **`frontmatter.js` is not modified.** It stays pure and storage-free; `defaultFrontmatter` keeps its current signature and is reused as the seed.
- **Renderer files are ES modules** (`import`/`export`), matching `src/renderer/`.
- **Storage functions take an injected `store`** (any object with `getItem`/`setItem`) so tests never touch a real `localStorage`, matching how the GitHub modules take an injected `fetch`.
- **No failure in this feature may prevent editing, saving or committing.** Storage errors degrade to an empty template list.
- **`window.prompt` must not be used** — Electron does not implement it (`prompt() is not supported.`). `window.confirm` is supported and may be used.
- **The `{today}` date is passed in by the caller**, never read inside a pure function.
- **Every task ends with `npm test` passing** before its commit.
- Existing tests in `tests/fmpanel-image.test.js` must keep passing unchanged.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/renderer/templates.js` | Pure merge/expand/capture plus template storage |
| `tests/templates.test.js` | Covers every function in `templates.js` |
| `tests/fmpanel-warning.test.js` | The empty-value marker (jsdom) |
| `tests/fmpanel-templates.test.js` | Selector, save, manage (jsdom) |

**Modified:** `src/renderer/fmpanel.js` (template bar, warning marker), `src/renderer/index.html` (two dialogs), `src/renderer/styles.css`, `README.md`, `CHANGELOG.md`, `CLAUDE.md`.

---

### Task 1: Empty-value warning

Independent of templates entirely. Ships a visible improvement on its own.

**Files:**
- Modify: `src/renderer/fmpanel.js`, `src/renderer/styles.css`
- Test: `tests/fmpanel-warning.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks depend on. A `.fm-warn` element is appended to each pair row, carrying the `hidden` class when the row is fine.

- [ ] **Step 1: Write the failing test**

Create `tests/fmpanel-warning.test.js`:

```js
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createFrontmatterPanel } from '../src/renderer/fmpanel.js';

function mount() {
  const root = document.createElement('div');
  document.body.append(root);
  return { root, panel: createFrontmatterPanel(root, () => {}) };
}

// The panel starts collapsed; expanding is what renders the rows.
function expand(root) {
  root.querySelector('.fm-header button').click();
}

function rowFor(root, key) {
  return [...root.querySelectorAll('.fm-row')].find(
    (r) => r.querySelector('.fm-key')?.value === key
  );
}

const warned = (row) => {
  const el = row.querySelector('.fm-warn');
  return Boolean(el) && !el.classList.contains('hidden');
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('empty frontmatter value warning', () => {
  it('marks a row that has a key but no value', () => {
    const { root, panel } = mount();
    panel.setFrontmatter('title:\ndate: 2026-07-31\n');
    expand(root);

    expect(warned(rowFor(root, 'title'))).toBe(true);
    expect(warned(rowFor(root, 'date'))).toBe(false);
  });

  it('treats a whitespace-only value as empty', () => {
    const { root, panel } = mount();
    panel.setFrontmatter('title:   \n');
    expand(root);
    expect(warned(rowFor(root, 'title'))).toBe(true);
  });

  it('does not mark a row whose key is still blank', () => {
    // An unfinished row the user is typing, not a mistake to report.
    const { root, panel } = mount();
    panel.setFrontmatter('title: Post\n');
    expand(root);
    root.querySelector('.fm-add-prop').click();

    const blank = [...root.querySelectorAll('.fm-row')].find(
      (r) => r.querySelector('.fm-key')?.value === ''
    );
    expect(warned(blank)).toBe(false);
  });

  it('clears as soon as a value is typed, without rebuilding the row', () => {
    const { root, panel } = mount();
    panel.setFrontmatter('title:\n');
    expand(root);

    const row = rowFor(root, 'title');
    const marker = row.querySelector('.fm-warn');
    expect(warned(row)).toBe(true);

    const value = row.querySelector('.fm-value');
    value.value = 'My Post';
    value.dispatchEvent(new Event('input'));

    expect(warned(row)).toBe(false);
    // Same element — the row was not re-rendered, so the caret is undisturbed.
    expect(row.querySelector('.fm-warn')).toBe(marker);
  });

  it('appears when a value is cleared again', () => {
    const { root, panel } = mount();
    panel.setFrontmatter('title: Post\n');
    expand(root);

    const row = rowFor(root, 'title');
    const value = row.querySelector('.fm-value');
    value.value = '';
    value.dispatchEvent(new Event('input'));

    expect(warned(row)).toBe(true);
  });

  it('appears when a key is typed next to an empty value', () => {
    const { root, panel } = mount();
    panel.setFrontmatter('title: Post\n');
    expand(root);
    root.querySelector('.fm-add-prop').click();

    const blank = [...root.querySelectorAll('.fm-row')].find(
      (r) => r.querySelector('.fm-key')?.value === ''
    );
    const key = blank.querySelector('.fm-key');
    key.value = 'description';
    key.dispatchEvent(new Event('input'));

    expect(warned(blank)).toBe(true);
  });

  it('explains itself in a tooltip', () => {
    const { root, panel } = mount();
    panel.setFrontmatter('title:\n');
    expand(root);
    expect(rowFor(root, 'title').querySelector('.fm-warn').title).toMatch(/null/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/fmpanel-warning.test.js`
Expected: FAIL — every assertion about `.fm-warn` fails because no such element exists.

- [ ] **Step 3: Write the implementation**

In `src/renderer/fmpanel.js`, replace the comment and declaration at lines 69-72:

```js
        // Assigned below when a picker is available; re-evaluated on every
        // keystroke so typing "hero" reveals the button without a re-render
        // that would steal the caret.
        let syncPicker = () => {};
```

with:

```js
        // Both of these re-evaluate on every keystroke, toggling elements in
        // place rather than re-rendering the row, which would steal the caret.
        let syncPicker = () => {};
        let syncWarning = () => {};
```

Then in the `key` input listener, add the warning sync — replace:

```js
        key.addEventListener('input', () => {
          row.key = key.value;
          syncPicker();
          onChange();
        });
```

with:

```js
        key.addEventListener('input', () => {
          row.key = key.value;
          syncPicker();
          syncWarning();
          onChange();
        });
```

and do the same for the `value` listener — replace:

```js
        value.addEventListener('input', () => {
          row.value = value.value;
          syncPicker();
          onChange();
        });
```

with:

```js
        value.addEventListener('input', () => {
          row.value = value.value;
          syncPicker();
          syncWarning();
          onChange();
        });
```

Then replace this line:

```js
        rowEl.append(key, value);
```

with the marker's creation and mounting:

```js
        // An empty value serializes to `key:`, which is null in YAML. Most
        // site generators reject that where they would accept a missing key
        // or an empty string. Visual only — it never blocks a save.
        const warn = document.createElement('span');
        warn.className = 'fm-warn';
        warn.textContent = '⚠';
        warn.title =
          'This value is empty, so it becomes null in YAML. Most site generators reject that — give it a value or remove the row.';
        syncWarning = () => {
          const isEmpty = row.key.trim() !== '' && row.value.trim() === '';
          warn.classList.toggle('hidden', !isEmpty);
        };
        syncWarning();

        rowEl.append(key, value, warn);
```

Finally, in the image picker's click handler, keep the warning in step with the new value — replace:

```js
            row.value = picked.url;
            value.value = picked.url;
            syncPicker();
            onChange();
```

with:

```js
            row.value = picked.url;
            value.value = picked.url;
            syncPicker();
            syncWarning();
            onChange();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/fmpanel-warning.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Style the marker**

Append to `src/renderer/styles.css`:

```css
.fm-row .fm-warn {
  flex: 0 0 auto;
  color: #8a6100;
  font-size: 13px;
  line-height: 1;
  cursor: help;
}
```

- [ ] **Step 6: Run the whole suite and commit**

Run: `npm test`
Expected: PASS — `tests/fmpanel-image.test.js` unaffected.

```bash
npm run build
git add src/renderer/fmpanel.js src/renderer/styles.css tests/fmpanel-warning.test.js
git commit -m "feat(frontmatter): warn when a property has no value"
```

---

### Task 2: The three pure operations

**Files:**
- Create: `src/renderer/templates.js`
- Test: `tests/templates.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `applyTemplate(existingRows, templateRows)` → new rows array. `existingRows` may be `null`.
  - `expandDefaults(templateRows, today)` → rows with every `{today}` occurrence replaced.
  - `templateFromRows(rows, today)` → template rows: `{ raw }` rows dropped, a value exactly equal to `today` stored as `{today}`.

- [ ] **Step 1: Write the failing test**

Create `tests/templates.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { applyTemplate, expandDefaults, templateFromRows } from '../src/renderer/templates.js';

const row = (key, value) => ({ key, value });

describe('applyTemplate', () => {
  it('adds only the keys that are missing', () => {
    const result = applyTemplate(
      [row('title', 'My Post')],
      [row('title', ''), row('description', ''), row('tags', '[]')]
    );
    expect(result).toEqual([
      row('title', 'My Post'),
      row('description', ''),
      row('tags', '[]'),
    ]);
  });

  it('never changes a value the user already set', () => {
    const result = applyTemplate([row('title', 'Mine')], [row('title', 'Default')]);
    expect(result).toEqual([row('title', 'Mine')]);
  });

  it('keeps existing rows in their original order', () => {
    const result = applyTemplate(
      [row('z', '1'), row('a', '2')],
      [row('a', ''), row('b', '')]
    );
    expect(result.map((r) => r.key)).toEqual(['z', 'a', 'b']);
  });

  it('preserves raw rows untouched', () => {
    const raw = { raw: 'nested:\n  a: 1' };
    const result = applyTemplate([raw, row('title', 'x')], [row('tags', '[]')]);
    expect(result[0]).toBe(raw);
    expect(result.map((r) => r.key)).toEqual([undefined, 'title', 'tags']);
  });

  it('treats keys as case-sensitive, matching YAML', () => {
    const result = applyTemplate([row('pubdate', '2026-01-01')], [row('pubDate', '')]);
    expect(result.map((r) => r.key)).toEqual(['pubdate', 'pubDate']);
  });

  it('is a no-op applied twice', () => {
    const template = [row('title', ''), row('tags', '[]')];
    const once = applyTemplate([row('title', 'Mine')], template);
    expect(applyTemplate(once, template)).toEqual(once);
  });

  it('creates the rows when the document has no frontmatter', () => {
    expect(applyTemplate(null, [row('title', '')])).toEqual([row('title', '')]);
  });

  it('does not mutate the array it was given', () => {
    const existing = [row('title', 'x')];
    applyTemplate(existing, [row('tags', '[]')]);
    expect(existing).toHaveLength(1);
  });

  it('ignores a duplicate key inside the template itself', () => {
    const result = applyTemplate([], [row('tags', '[]'), row('tags', 'other')]);
    expect(result).toEqual([row('tags', '[]')]);
  });

  it('handles an empty template', () => {
    expect(applyTemplate([row('title', 'x')], [])).toEqual([row('title', 'x')]);
  });
});

describe('expandDefaults', () => {
  it('replaces the today token', () => {
    expect(expandDefaults([row('date', '{today}')], '2026-07-31'))
      .toEqual([row('date', '2026-07-31')]);
  });

  it('leaves other values alone', () => {
    expect(expandDefaults([row('tags', '[]')], '2026-07-31'))
      .toEqual([row('tags', '[]')]);
  });

  it('replaces the token inside a longer value', () => {
    expect(expandDefaults([row('slug', 'archive/{today}.md')], '2026-07-31'))
      .toEqual([row('slug', 'archive/2026-07-31.md')]);
  });

  it('replaces the token in every row and more than once per value', () => {
    expect(expandDefaults([row('a', '{today}'), row('b', '{today}/{today}')], '2026-07-31'))
      .toEqual([row('a', '2026-07-31'), row('b', '2026-07-31/2026-07-31')]);
  });

  it('does not mutate the template it was given', () => {
    const template = [row('date', '{today}')];
    expandDefaults(template, '2026-07-31');
    expect(template[0].value).toBe('{today}');
  });
});

describe('templateFromRows', () => {
  it('stores a value equal to today as the token', () => {
    expect(templateFromRows([row('date', '2026-07-31')], '2026-07-31'))
      .toEqual([row('date', '{today}')]);
  });

  it('leaves a different date literal', () => {
    expect(templateFromRows([row('date', '2020-01-01')], '2026-07-31'))
      .toEqual([row('date', '2020-01-01')]);
  });

  it('only substitutes an exact match, not a date inside a longer value', () => {
    expect(templateFromRows([row('slug', 'post-2026-07-31')], '2026-07-31'))
      .toEqual([row('slug', 'post-2026-07-31')]);
  });

  it('drops raw rows, which mean nothing as a default', () => {
    expect(templateFromRows([{ raw: 'nested:' }, row('title', 'x')], '2026-07-31'))
      .toEqual([row('title', 'x')]);
  });

  it('keeps empty values, which are a legitimate default to fill in', () => {
    expect(templateFromRows([row('title', '')], '2026-07-31'))
      .toEqual([row('title', '')]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/templates.test.js`
Expected: FAIL — cannot resolve `../src/renderer/templates.js`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/templates.js`:

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/templates.test.js`
Expected: PASS (20 tests).

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add src/renderer/templates.js tests/templates.test.js
git commit -m "feat(frontmatter): add template merge and token expansion"
```

---

### Task 3: Template storage and seeding

**Files:**
- Modify: `src/renderer/templates.js`
- Test: `tests/templates.test.js` (extend)

**Interfaces:**
- Consumes: nothing from Task 2 at runtime; shares the file.
- Produces (all take `store`, any object with `getItem(key)` / `setItem(key, value)`):
  - `ensureSeeded(store, basicRows)` → void. Writes the `Basic` template once, ever.
  - `listTemplates(store)` → `[{ name, rows }]`, insertion-ordered.
  - `saveTemplate(store, name, rows)` → `true` on success, `false` if rejected.
  - `deleteTemplate(store, name)` → `true` if it existed.
  - `renameTemplate(store, oldName, newName)` → `true` on success, `false` if rejected.

Storage shape under the single key `markpad.templates`:

```json
{ "version": 1, "seeded": true, "templates": { "Basic": [ { "key": "title", "value": "" } ] } }
```

- [ ] **Step 1: Write the failing test**

Append to `tests/templates.test.js`:

```js
import {
  ensureSeeded,
  listTemplates,
  saveTemplate,
  deleteTemplate,
  renameTemplate,
} from '../src/renderer/templates.js';

// Minimal stand-in for localStorage.
function fakeStore(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
  };
}

const KEY = 'markpad.templates';
const BASIC = [{ key: 'title', value: '' }, { key: 'date', value: '{today}' }];

describe('template storage', () => {
  it('starts empty', () => {
    expect(listTemplates(fakeStore())).toEqual([]);
  });

  it('saves and lists a template', () => {
    const store = fakeStore();
    expect(saveTemplate(store, 'Blog post', [{ key: 'title', value: '' }])).toBe(true);
    expect(listTemplates(store)).toEqual([
      { name: 'Blog post', rows: [{ key: 'title', value: '' }] },
    ]);
  });

  it('trims the name', () => {
    const store = fakeStore();
    saveTemplate(store, '  Spaced  ', [{ key: 'a', value: '' }]);
    expect(listTemplates(store)[0].name).toBe('Spaced');
  });

  it('rejects an empty or whitespace-only name', () => {
    const store = fakeStore();
    expect(saveTemplate(store, '   ', [{ key: 'a', value: '' }])).toBe(false);
    expect(saveTemplate(store, '', [{ key: 'a', value: '' }])).toBe(false);
    expect(listTemplates(store)).toEqual([]);
  });

  it('rejects a template with no rows', () => {
    const store = fakeStore();
    expect(saveTemplate(store, 'Empty', [])).toBe(false);
    expect(listTemplates(store)).toEqual([]);
  });

  it('overwrites a template of the same name in place', () => {
    const store = fakeStore();
    saveTemplate(store, 'A', [{ key: 'one', value: '' }]);
    saveTemplate(store, 'A', [{ key: 'two', value: '' }]);
    expect(listTemplates(store)).toEqual([
      { name: 'A', rows: [{ key: 'two', value: '' }] },
    ]);
  });

  it('deletes', () => {
    const store = fakeStore();
    saveTemplate(store, 'A', [{ key: 'a', value: '' }]);
    expect(deleteTemplate(store, 'A')).toBe(true);
    expect(listTemplates(store)).toEqual([]);
  });

  it('reports deleting something that is not there', () => {
    expect(deleteTemplate(fakeStore(), 'Nope')).toBe(false);
  });

  it('renames, keeping the rows', () => {
    const store = fakeStore();
    saveTemplate(store, 'Old', [{ key: 'a', value: '1' }]);
    expect(renameTemplate(store, 'Old', 'New')).toBe(true);
    expect(listTemplates(store)).toEqual([
      { name: 'New', rows: [{ key: 'a', value: '1' }] },
    ]);
  });

  it('refuses a rename onto an existing name, or from one that is missing', () => {
    const store = fakeStore();
    saveTemplate(store, 'A', [{ key: 'a', value: '' }]);
    saveTemplate(store, 'B', [{ key: 'b', value: '' }]);
    expect(renameTemplate(store, 'A', 'B')).toBe(false);
    expect(renameTemplate(store, 'Missing', 'C')).toBe(false);
    expect(listTemplates(store).map((t) => t.name)).toEqual(['A', 'B']);
  });

  it('refuses a rename to a blank name', () => {
    const store = fakeStore();
    saveTemplate(store, 'A', [{ key: 'a', value: '' }]);
    expect(renameTemplate(store, 'A', '  ')).toBe(false);
  });
});

describe('seeding', () => {
  it('adds Basic on first run', () => {
    const store = fakeStore();
    ensureSeeded(store, BASIC);
    expect(listTemplates(store)).toEqual([{ name: 'Basic', rows: BASIC }]);
  });

  it('does not add Basic a second time', () => {
    const store = fakeStore();
    ensureSeeded(store, BASIC);
    saveTemplate(store, 'Basic', [{ key: 'changed', value: '' }]);
    ensureSeeded(store, BASIC);
    expect(listTemplates(store)[0].rows).toEqual([{ key: 'changed', value: '' }]);
  });

  it('does not resurrect Basic after it is deleted', () => {
    const store = fakeStore();
    ensureSeeded(store, BASIC);
    deleteTemplate(store, 'Basic');
    ensureSeeded(store, BASIC);
    expect(listTemplates(store)).toEqual([]);
  });
});

describe('storage resilience', () => {
  it('treats corrupt JSON as empty', () => {
    expect(listTemplates(fakeStore({ [KEY]: 'not json' }))).toEqual([]);
  });

  it('treats a valid but wrongly shaped payload as empty', () => {
    expect(listTemplates(fakeStore({ [KEY]: '[1,2,3]' }))).toEqual([]);
  });

  it('survives a store that throws on read', () => {
    const store = { getItem() { throw new Error('denied'); }, setItem() {} };
    expect(listTemplates(store)).toEqual([]);
  });

  it('survives a store that throws on write', () => {
    const store = { getItem: () => null, setItem() { throw new Error('full'); } };
    expect(() => saveTemplate(store, 'A', [{ key: 'a', value: '' }])).not.toThrow();
  });

  it('writes the versioned shape', () => {
    const store = fakeStore();
    saveTemplate(store, 'A', [{ key: 'a', value: '' }]);
    expect(JSON.parse(store.data[KEY])).toMatchObject({ version: 1, templates: { A: [{ key: 'a', value: '' }] } });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/templates.test.js`
Expected: FAIL — `ensureSeeded` and the other storage functions are not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/renderer/templates.js`:

```js
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
```

Note `renameTemplate` rebuilds the object rather than deleting and re-adding, so the template keeps its position in the list instead of jumping to the end.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/templates.test.js`
Expected: PASS (39 tests).

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add src/renderer/templates.js tests/templates.test.js
git commit -m "feat(frontmatter): store templates with one-time seeding"
```

---

### Task 4: The template selector

After this task you can pick a template and watch it fill the panel.

**Files:**
- Modify: `src/renderer/fmpanel.js`, `src/renderer/styles.css`
- Test: `tests/fmpanel-templates.test.js`

**Interfaces:**
- Consumes: `applyTemplate`, `expandDefaults` (Task 2); `ensureSeeded`, `listTemplates` (Task 3); `defaultFrontmatter` (existing, in `frontmatter.js`).
- Produces: `createFrontmatterPanel(root, onChange, { onPickImage, store, today })`. `store` defaults to `globalThis.localStorage`, `today` to a function returning the current date as `YYYY-MM-DD`. Both exist so tests can inject; production passes neither. The bar renders as `.fm-template-bar` containing `.fm-template-select`.

The `Manage…` entry is added in Task 6, not here — an option that did nothing would be worse than its absence.

- [ ] **Step 1: Write the failing test**

Create `tests/fmpanel-templates.test.js`:

```js
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createFrontmatterPanel } from '../src/renderer/fmpanel.js';

function fakeStore(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
  };
}

function seeded(templates) {
  return {
    'markpad.templates': JSON.stringify({ version: 1, seeded: true, templates }),
  };
}

function mount(store, today = () => '2026-07-31') {
  const root = document.createElement('div');
  document.body.append(root);
  const panel = createFrontmatterPanel(root, () => {}, { store, today });
  return { root, panel };
}

const select = (root) => root.querySelector('.fm-template-select');
const optionNames = (root) => [...select(root).options].map((o) => o.textContent);

// Just the saved templates. Ignoring the fixed entries keeps these assertions
// stable when Task 6 adds "Manage…" to the same control.
const templateNames = (root) =>
  optionNames(root).filter((n) => n !== 'Choose…' && n !== 'Manage…');

function choose(root, name) {
  const el = select(root);
  el.value = name;
  el.dispatchEvent(new Event('change'));
}

function keysIn(root) {
  return [...root.querySelectorAll('.fm-key')].map((i) => i.value);
}

function expand(root) {
  root.querySelector('.fm-header button')?.click();
}

beforeEach(() => {
  document.body.innerHTML = '';
});

const BLOG = [
  { key: 'title', value: '' },
  { key: 'pubDate', value: '{today}' },
  { key: 'tags', value: '[]' },
];

describe('template selector', () => {
  it('is visible on a document with no frontmatter', () => {
    const { root } = mount(fakeStore(seeded({ 'Blog post': BLOG })));
    expect(select(root)).not.toBeNull();
    expect(templateNames(root)).toEqual(['Blog post']);
  });

  it('opens with the placeholder selected, and the placeholder is disabled', () => {
    const { root } = mount(fakeStore(seeded({ 'Blog post': BLOG })));
    expect(select(root).selectedIndex).toBe(0);
    expect(select(root).options[0].disabled).toBe(true);
  });

  it('creates frontmatter from a template when there is none', () => {
    const { root, panel } = mount(fakeStore(seeded({ 'Blog post': BLOG })));
    choose(root, 'Blog post');
    expect(keysIn(root)).toEqual(['title', 'pubDate', 'tags']);
    expect(panel.getFrontmatter()).toContain('pubDate: 2026-07-31');
  });

  it('expands the panel so the result is visible', () => {
    const { root } = mount(fakeStore(seeded({ 'Blog post': BLOG })));
    choose(root, 'Blog post');
    expect(root.querySelector('.fm-rows')).not.toBeNull();
  });

  it('adds only missing keys to existing frontmatter', () => {
    const { root, panel } = mount(fakeStore(seeded({ 'Blog post': BLOG })));
    panel.setFrontmatter('title: My Post\n');
    choose(root, 'Blog post');
    expand(root);
    expect(keysIn(root)).toEqual(['title', 'pubDate', 'tags']);
    expect(panel.getFrontmatter()).toContain('title: My Post');
  });

  it('returns to the placeholder after applying', () => {
    const { root } = mount(fakeStore(seeded({ 'Blog post': BLOG })));
    choose(root, 'Blog post');
    expect(select(root).selectedIndex).toBe(0);
  });

  it('can be applied twice with no duplicate keys', () => {
    const { root } = mount(fakeStore(seeded({ 'Blog post': BLOG })));
    choose(root, 'Blog post');
    choose(root, 'Blog post');
    expect(keysIn(root)).toEqual(['title', 'pubDate', 'tags']);
  });

  it('seeds Basic into an untouched store', () => {
    const store = fakeStore();
    const { root } = mount(store);
    expect(templateNames(root)).toEqual(['Basic']);
  });

  it('reports the change so the document becomes dirty', () => {
    const root = document.createElement('div');
    document.body.append(root);
    let changes = 0;
    createFrontmatterPanel(root, () => { changes += 1; }, {
      store: fakeStore(seeded({ 'Blog post': BLOG })),
      today: () => '2026-07-31',
    });
    root.querySelector('.fm-template-select').value = 'Blog post';
    root.querySelector('.fm-template-select').dispatchEvent(new Event('change'));
    expect(changes).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/fmpanel-templates.test.js`
Expected: FAIL — `.fm-template-select` does not exist.

- [ ] **Step 3: Write the implementation**

In `src/renderer/fmpanel.js`, replace the import block and function signature at lines 1-13:

```js
import {
  parseFrontmatter,
  serializeFrontmatter,
  defaultFrontmatter,
} from './frontmatter.js';
import { wantsImagePicker } from './github-paths.js';

// onPickImage is optional: when supplied it resolves to { url } for an image
// the caller has staged, or null if the user cancelled. Rows whose key or
// value looks image-shaped grow a picker button that fills in the value.
export function createFrontmatterPanel(root, onChange, { onPickImage = null } = {}) {
  let rows = null; // null = document has no frontmatter
  let collapsed = true;
```

with:

```js
import {
  parseFrontmatter,
  serializeFrontmatter,
  defaultFrontmatter,
} from './frontmatter.js';
import { wantsImagePicker } from './github-paths.js';
import {
  applyTemplate,
  expandDefaults,
  ensureSeeded,
  listTemplates,
} from './templates.js';

const isoToday = () => new Date().toISOString().slice(0, 10);

// onPickImage is optional: when supplied it resolves to { url } for an image
// the caller has staged, or null if the user cancelled. Rows whose key or
// value looks image-shaped grow a picker button that fills in the value.
// store and today exist so tests can inject them; production passes neither.
export function createFrontmatterPanel(
  root,
  onChange,
  { onPickImage = null, store = globalThis.localStorage, today = isoToday } = {}
) {
  let rows = null; // null = document has no frontmatter
  let collapsed = true;

  // Seeded once per store, so the list is never empty on a first run.
  ensureSeeded(store, defaultFrontmatter('{today}'));

  // Applying is additive: it fills in keys the document lacks and never
  // touches a value already there, so this is safe to press at any time.
  function chooseTemplate(name) {
    const template = listTemplates(store).find((t) => t.name === name);
    if (!template) return;
    rows = applyTemplate(rows, expandDefaults(template.rows, today()));
    collapsed = false;
    render();
    onChange();
  }

  function renderTemplateBar() {
    const bar = document.createElement('div');
    bar.className = 'fm-template-bar';

    const label = document.createElement('span');
    label.className = 'fm-template-label';
    label.textContent = 'Template';

    const select = document.createElement('select');
    select.className = 'fm-template-select';
    const placeholder = new Option('Choose…', '');
    placeholder.disabled = true;
    placeholder.selected = true;
    select.append(placeholder);
    for (const template of listTemplates(store)) {
      select.append(new Option(template.name, template.name));
    }
    select.addEventListener('change', () => {
      const chosen = select.value;
      // The control is an action, not a record of what the document is:
      // MarkPad cannot know a document still "is" a blog post once edited.
      select.selectedIndex = 0;
      if (chosen) chooseTemplate(chosen);
    });

    bar.append(label, select);
    root.appendChild(bar);
  }
```

Then, inside `render()`, add the bar as the first thing drawn — replace:

```js
  function render() {
    root.innerHTML = '';

    if (rows === null) {
```

with:

```js
  function render() {
    root.innerHTML = '';
    renderTemplateBar();

    if (rows === null) {
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/fmpanel-templates.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Style the bar**

Append to `src/renderer/styles.css`:

```css
.fm-template-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px 0;
}

.fm-template-label {
  color: var(--muted);
  font-size: 12px;
}

.fm-template-select {
  flex: 0 1 220px;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: rgba(255, 255, 255, 0.82);
  color: var(--fg);
  font: inherit;
  font-size: 12px;
}
```

- [ ] **Step 6: Run the whole suite and commit**

Run: `npm test`
Expected: PASS — `tests/fmpanel-image.test.js` and `tests/fmpanel-warning.test.js` still find `.fm-header button`, which the new bar does not displace.

```bash
npm run build
git add src/renderer/fmpanel.js src/renderer/styles.css tests/fmpanel-templates.test.js
git commit -m "feat(frontmatter): apply a saved template from the panel"
```

- [ ] **Step 7: Verify by hand**

Run: `npm start`
Expected: the frontmatter panel shows a Template dropdown containing `Basic`. Choosing it on an empty document creates `title`, `date` (today's date), and `tags` rows, and the dropdown snaps back to `Choose…`. Choosing it again adds nothing.

---

### Task 5: Save the current frontmatter as a template

**Files:**
- Modify: `src/renderer/fmpanel.js`, `src/renderer/index.html`, `src/renderer/styles.css`
- Test: `tests/fmpanel-templates.test.js` (extend)

**Interfaces:**
- Consumes: `templateFromRows` (Task 2), `saveTemplate` (Task 3).
- Produces: a `.fm-template-save` button in the bar, and `#template-dialog` in the markup, reused by Task 6 for renaming.

- [ ] **Step 1: Add the dialog markup**

In `src/renderer/index.html`, add next to the other dialogs, immediately before `<script src="../../dist/renderer.js"></script>`:

```html
  <dialog id="template-dialog">
    <form method="dialog">
      <label id="template-label" for="template-name">Template name</label>
      <input id="template-name" type="text" />
      <div class="dialog-buttons">
        <button value="cancel">Cancel</button>
        <button value="ok" id="template-ok">Save template</button>
      </div>
    </form>
  </dialog>
```

- [ ] **Step 2: Write the failing test**

Append to `tests/fmpanel-templates.test.js`:

```js
// The dialog lives in index.html; the tests build the same nodes.
function installDialog() {
  document.body.insertAdjacentHTML('beforeend', `
    <dialog id="template-dialog">
      <form method="dialog">
        <label id="template-label" for="template-name">Template name</label>
        <input id="template-name" type="text" />
        <div class="dialog-buttons">
          <button value="cancel">Cancel</button>
          <button value="ok" id="template-ok">Save template</button>
        </div>
      </form>
    </dialog>
  `);
  const dialog = document.getElementById('template-dialog');
  // jsdom implements neither showModal nor close.
  dialog.showModal = function () { this.open = true; };
  dialog.close = function (value) {
    this.open = false;
    if (value !== undefined) this.returnValue = value;
    this.dispatchEvent(new Event('close'));
  };
  return dialog;
}

function answerDialog(dialog, name) {
  document.getElementById('template-name').value = name;
  dialog.close('ok');
}

describe('save as template', () => {
  it('is hidden when the document has no frontmatter to save', () => {
    installDialog();
    const { root } = mount(fakeStore(seeded({})));
    expect(root.querySelector('.fm-template-save')).toBeNull();
  });

  it('captures the current rows under the given name', async () => {
    const dialog = installDialog();
    const store = fakeStore(seeded({}));
    const { root, panel } = mount(store);
    panel.setFrontmatter('title: My Post\ntags: [a]\n');

    root.querySelector('.fm-template-save').click();
    answerDialog(dialog, 'Blog post');
    await Promise.resolve();
    await Promise.resolve();

    const stored = JSON.parse(store.data['markpad.templates']).templates;
    expect(stored['Blog post']).toEqual([
      { key: 'title', value: 'My Post' },
      { key: 'tags', value: '[a]' },
    ]);
  });

  it('stores today\'s date as the token', async () => {
    const dialog = installDialog();
    const store = fakeStore(seeded({}));
    const { root, panel } = mount(store);
    panel.setFrontmatter('date: 2026-07-31\n');

    root.querySelector('.fm-template-save').click();
    answerDialog(dialog, 'Dated');
    await Promise.resolve();
    await Promise.resolve();

    const stored = JSON.parse(store.data['markpad.templates']).templates;
    expect(stored.Dated).toEqual([{ key: 'date', value: '{today}' }]);
  });

  it('saves nothing when the name is cancelled', async () => {
    const dialog = installDialog();
    const store = fakeStore(seeded({}));
    const { root, panel } = mount(store);
    panel.setFrontmatter('title: x\n');

    root.querySelector('.fm-template-save').click();
    dialog.close('cancel');
    await Promise.resolve();
    await Promise.resolve();

    expect(JSON.parse(store.data['markpad.templates']).templates).toEqual({});
  });

  it('offers the new template in the selector straight away', async () => {
    const dialog = installDialog();
    const { root, panel } = mount(fakeStore(seeded({})));
    panel.setFrontmatter('title: x\n');

    root.querySelector('.fm-template-save').click();
    answerDialog(dialog, 'Fresh');
    await Promise.resolve();
    await Promise.resolve();

    expect(templateNames(root)).toContain('Fresh');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/fmpanel-templates.test.js -t "save as template"`
Expected: FAIL — `.fm-template-save` does not exist.

- [ ] **Step 4: Write the implementation**

In `src/renderer/fmpanel.js`, extend the templates import to include the two new functions:

```js
import {
  applyTemplate,
  expandDefaults,
  ensureSeeded,
  listTemplates,
  saveTemplate,
  templateFromRows,
} from './templates.js';
```

Add these functions just above `renderTemplateBar`:

```js
  // Electron does not implement window.prompt(), so naming uses the app's
  // own dialog. Resolves to the trimmed name, or null if cancelled.
  function askName(labelText, okText, initial = '') {
    const dialog = document.getElementById('template-dialog');
    const input = document.getElementById('template-name');
    document.getElementById('template-label').textContent = labelText;
    document.getElementById('template-ok').textContent = okText;
    input.value = initial;
    dialog.returnValue = 'cancel';
    dialog.showModal();
    input.select?.();
    return new Promise((resolve) => {
      dialog.addEventListener('close', () => {
        resolve(dialog.returnValue === 'ok' ? input.value.trim() : null);
      }, { once: true });
    });
  }

  async function saveAsTemplate() {
    const captured = templateFromRows(rows || [], today());
    if (captured.length === 0) return;
    const name = await askName('Template name', 'Save template');
    if (!name) return;
    const exists = listTemplates(store).some((t) => t.name === name);
    if (exists && !window.confirm(`Replace the template "${name}"?`)) return;
    saveTemplate(store, name, captured);
    render();
  }
```

Then in `renderTemplateBar`, add the button after the select — replace:

```js
    bar.append(label, select);
    root.appendChild(bar);
```

with:

```js
    bar.append(label, select);

    // Only offered when there is something to capture.
    if (rows && rows.some((r) => r.raw === undefined)) {
      const save = document.createElement('button');
      save.className = 'fm-template-save';
      save.textContent = 'Save as template…';
      save.addEventListener('click', saveAsTemplate);
      bar.append(save);
    }

    root.appendChild(bar);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/fmpanel-templates.test.js`
Expected: PASS (14 tests).

- [ ] **Step 6: Style the button**

Append to `src/renderer/styles.css`:

```css
.fm-template-save {
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: rgba(255, 255, 255, 0.82);
  color: var(--fg);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.fm-template-save:hover {
  background: var(--accent-soft);
  border-color: var(--accent);
}

#template-dialog input {
  display: block;
  width: 100%;
  margin: 6px 0 12px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: #fff;
  color: var(--fg);
  font: inherit;
}
```

- [ ] **Step 7: Run the whole suite and commit**

Run: `npm test`
Expected: PASS.

```bash
npm run build
git add src/renderer/fmpanel.js src/renderer/index.html src/renderer/styles.css tests/fmpanel-templates.test.js
git commit -m "feat(frontmatter): save the current frontmatter as a template"
```

- [ ] **Step 8: Verify by hand**

Run: `npm start`
Expected: with frontmatter present, "Save as template…" prompts for a name and the template then appears in the dropdown. Saving under an existing name asks before replacing. Cancelling saves nothing.

---

### Task 6: Manage templates

**Files:**
- Modify: `src/renderer/fmpanel.js`, `src/renderer/index.html`, `src/renderer/styles.css`
- Test: `tests/fmpanel-templates.test.js` (extend)

**Interfaces:**
- Consumes: `listTemplates`, `deleteTemplate`, `renameTemplate` (Task 3); `askName` (Task 5).
- Produces: a `Manage…` option in the selector and `#template-manage-dialog` in the markup, whose rows carry `.fm-manage-row` with `.fm-manage-rename` and `.fm-manage-delete` buttons.

- [ ] **Step 1: Add the dialog markup**

In `src/renderer/index.html`, add immediately after `#template-dialog`:

```html
  <dialog id="template-manage-dialog">
    <h3>Templates</h3>
    <div id="template-manage-list"></div>
    <div class="dialog-buttons">
      <button id="template-manage-close" type="button">Close</button>
    </div>
  </dialog>
```

- [ ] **Step 2: Write the failing test**

Append to `tests/fmpanel-templates.test.js`:

```js
function installManageDialog() {
  document.body.insertAdjacentHTML('beforeend', `
    <dialog id="template-manage-dialog">
      <h3>Templates</h3>
      <div id="template-manage-list"></div>
      <div class="dialog-buttons">
        <button id="template-manage-close" type="button">Close</button>
      </div>
    </dialog>
  `);
  const dialog = document.getElementById('template-manage-dialog');
  dialog.showModal = function () { this.open = true; };
  dialog.close = function () { this.open = false; this.dispatchEvent(new Event('close')); };
  return dialog;
}

const manageRows = () =>
  [...document.querySelectorAll('.fm-manage-row')].map(
    (r) => r.querySelector('.fm-manage-name').textContent
  );

describe('manage templates', () => {
  it('lists every template', () => {
    installDialog();
    const manage = installManageDialog();
    const { root } = mount(fakeStore(seeded({ A: [{ key: 'a', value: '' }], B: [{ key: 'b', value: '' }] })));

    choose(root, '__manage__');
    expect(manage.open).toBe(true);
    expect(manageRows()).toEqual(['A', 'B']);
  });

  it('does not apply anything when Manage is chosen', () => {
    installDialog();
    installManageDialog();
    const { root, panel } = mount(fakeStore(seeded({ A: [{ key: 'a', value: '' }] })));
    choose(root, '__manage__');
    expect(panel.getFrontmatter()).toBeNull();
  });

  it('deletes after confirmation', () => {
    installDialog();
    installManageDialog();
    const store = fakeStore(seeded({ A: [{ key: 'a', value: '' }] }));
    const { root } = mount(store);
    const confirm = window.confirm;
    window.confirm = () => true;

    choose(root, '__manage__');
    document.querySelector('.fm-manage-delete').click();

    window.confirm = confirm;
    expect(manageRows()).toEqual([]);
    expect(templateNames(root)).toEqual([]);
  });

  it('keeps the template when the deletion is declined', () => {
    installDialog();
    installManageDialog();
    const { root } = mount(fakeStore(seeded({ A: [{ key: 'a', value: '' }] })));
    const confirm = window.confirm;
    window.confirm = () => false;

    choose(root, '__manage__');
    document.querySelector('.fm-manage-delete').click();

    window.confirm = confirm;
    expect(manageRows()).toEqual(['A']);
  });

  it('renames through the name dialog', async () => {
    const nameDialog = installDialog();
    installManageDialog();
    const store = fakeStore(seeded({ A: [{ key: 'a', value: '' }] }));
    const { root } = mount(store);

    choose(root, '__manage__');
    document.querySelector('.fm-manage-rename').click();
    answerDialog(nameDialog, 'Renamed');
    await Promise.resolve();
    await Promise.resolve();

    expect(manageRows()).toEqual(['Renamed']);
    expect(templateNames(root)).toContain('Renamed');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/fmpanel-templates.test.js -t "manage templates"`
Expected: FAIL — the selector has no `Manage…` option.

- [ ] **Step 4: Write the implementation**

In `src/renderer/fmpanel.js`, extend the templates import once more:

```js
import {
  applyTemplate,
  expandDefaults,
  ensureSeeded,
  listTemplates,
  saveTemplate,
  deleteTemplate,
  renameTemplate,
  templateFromRows,
} from './templates.js';
```

Add these two functions just above `renderTemplateBar`:

```js
  function renderManageList() {
    const list = document.getElementById('template-manage-list');
    list.innerHTML = '';
    const templates = listTemplates(store);

    if (templates.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'fm-manage-empty';
      empty.textContent = 'No templates yet. Save one from a document\'s frontmatter.';
      list.append(empty);
      return;
    }

    for (const template of templates) {
      const row = document.createElement('div');
      row.className = 'fm-manage-row';

      const name = document.createElement('span');
      name.className = 'fm-manage-name';
      name.textContent = template.name;

      const rename = document.createElement('button');
      rename.className = 'fm-manage-rename';
      rename.textContent = 'Rename';
      rename.addEventListener('click', async () => {
        const next = await askName('Rename template', 'Rename', template.name);
        if (!next || next === template.name) return;
        if (!renameTemplate(store, template.name, next)) {
          window.alert(`Could not rename to "${next}" — that name is already taken.`);
          return;
        }
        renderManageList();
        render();
      });

      const remove = document.createElement('button');
      remove.className = 'fm-manage-delete';
      remove.textContent = 'Delete';
      remove.addEventListener('click', () => {
        if (!window.confirm(`Delete the template "${template.name}"?`)) return;
        deleteTemplate(store, template.name);
        renderManageList();
        render();
      });

      row.append(name, rename, remove);
      list.append(row);
    }
  }

  function openManage() {
    const dialog = document.getElementById('template-manage-dialog');
    renderManageList();
    document.getElementById('template-manage-close')
      .addEventListener('click', () => dialog.close(), { once: true });
    dialog.showModal();
  }
```

Then in `renderTemplateBar`, add the entry after the template options — replace:

```js
    for (const template of listTemplates(store)) {
      select.append(new Option(template.name, template.name));
    }
    select.addEventListener('change', () => {
      const chosen = select.value;
      // The control is an action, not a record of what the document is:
      // MarkPad cannot know a document still "is" a blog post once edited.
      select.selectedIndex = 0;
      if (chosen) chooseTemplate(chosen);
    });
```

with:

```js
    for (const template of listTemplates(store)) {
      select.append(new Option(template.name, template.name));
    }
    select.append(new Option('Manage…', '__manage__'));
    select.addEventListener('change', () => {
      const chosen = select.value;
      // The control is an action, not a record of what the document is:
      // MarkPad cannot know a document still "is" a blog post once edited.
      select.selectedIndex = 0;
      if (chosen === '__manage__') openManage();
      else if (chosen) chooseTemplate(chosen);
    });
```

Note the rename handler's failure path uses `window.alert`, which Electron supports; `window.prompt` is the one it does not.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/fmpanel-templates.test.js`
Expected: PASS (19 tests).

- [ ] **Step 6: Style the list**

Append to `src/renderer/styles.css`:

```css
#template-manage-list {
  min-width: 280px;
  margin: 8px 0 12px;
}

.fm-manage-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  border-bottom: 1px solid var(--border);
}

.fm-manage-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fm-manage-row button {
  padding: 3px 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: rgba(255, 255, 255, 0.82);
  color: var(--fg);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.fm-manage-row .fm-manage-delete:hover {
  border-color: var(--danger);
  color: var(--danger);
}

.fm-manage-empty {
  margin: 8px 0;
  color: var(--muted);
}
```

- [ ] **Step 7: Run the whole suite and commit**

Run: `npm test`
Expected: PASS.

```bash
npm run build
git add src/renderer/fmpanel.js src/renderer/index.html src/renderer/styles.css tests/fmpanel-templates.test.js
git commit -m "feat(frontmatter): rename and delete saved templates"
```

- [ ] **Step 8: Verify by hand**

Run: `npm start`
Expected: choosing "Manage…" opens a list of templates with Rename and Delete, and applies nothing to the document. Deleting `Basic` and restarting the app leaves it deleted — the seeding flag is what makes this stick, and it is the behaviour most likely to regress.

---

### Task 7: Documentation

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `CLAUDE.md`

- [ ] **Step 1: Document the feature in the README**

Add a "Frontmatter templates" subsection under the existing frontmatter bullet covering: the Template dropdown applies a saved template, applying only ever adds missing keys and never overwrites, "Save as template…" captures the current fields, `{today}` resolves to the current date, "Manage…" renames and deletes, and templates are stored in MarkPad rather than in the project so they work for local files as well as repositories.

Also note the empty-value warning: a property with a key but no value is flagged because it becomes YAML null, which most site generators reject.

- [ ] **Step 2: Add a CHANGELOG entry**

Under `## [Unreleased]`, in `### Added`, following the existing format:

```markdown
- Frontmatter templates: apply a saved set of frontmatter keys to a document,
  save the current frontmatter as a named template, and rename or delete
  templates. Applying only adds keys that are missing and never overwrites a
  value. Templates are stored in MarkPad, so they work for local files as well
  as repository documents.
- A frontmatter property with a key but no value is flagged, because an empty
  value becomes null in YAML and most site generators reject it.
```

- [ ] **Step 3: Extend CLAUDE.md's Frontmatter section**

Add to the existing "Frontmatter" subsection: `templates.js` owns template storage and the pure merge, and `frontmatter.js` deliberately knows nothing about it. Note that `applyTemplate` is additive by design — it never overwrites an existing row — and that storage carries a `seeded` flag so deleting the built-in `Basic` template sticks across restarts.

- [ ] **Step 4: Commit**

```bash
npm test
git add README.md CHANGELOG.md CLAUDE.md
git commit -m "docs: document frontmatter templates"
```

---

## Manual Verification Checklist

Run through this after Task 7:

- [ ] A fresh install shows `Basic` in the dropdown
- [ ] Applying `Basic` to an empty document creates title/date/tags with today's date
- [ ] Applying a template to a document that already has some of its keys adds only the missing ones and changes no existing value
- [ ] Applying the same template twice adds nothing the second time
- [ ] The dropdown returns to `Choose…` after every application
- [ ] "Save as template…" captures the current fields; saving over an existing name asks first
- [ ] A saved template containing today's date resolves to the current date when applied on a later day
- [ ] "Manage…" renames and deletes; renaming onto an existing name is refused with an explanation
- [ ] Deleting `Basic`, then restarting the app, leaves it deleted
- [ ] A property with a key and no value shows the warning; typing a value clears it without the caret jumping
- [ ] The warning never prevents saving a local file or committing to a repository
- [ ] Frontmatter editing, the image picker, and GitHub commits all behave as before
