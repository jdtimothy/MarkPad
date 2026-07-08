# MarkPad Markdown Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Windows Electron desktop app for editing one markdown file at a time, with a GFM formatting toolbar, a collapsible frontmatter panel, and an Edit/Preview toggle.

**Architecture:** Electron main process owns the window, native dialogs, and file I/O; the renderer is plain HTML/CSS/JS bundled with esbuild. Formatting and frontmatter logic are pure functions (unit-tested, CodeMirror-independent) applied through thin adapters. The frontmatter panel owns the YAML block — the editor and preview only ever see the document body. Preview is a markdown-it pipeline sanitized with DOMPurify, with Mermaid rendered post-sanitize.

**Tech Stack:** Electron, esbuild, CodeMirror 6, markdown-it (+ footnote, task-lists, texmath/KaTeX plugins), Mermaid, DOMPurify, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-07-markdown-editor-design.md`

## Global Constraints

- `contextIsolation: true`, `nodeIntegration: false`; renderer talks to main only via the preload bridge exposed as `window.markpad`.
- Renderer is plain HTML/CSS/JavaScript — no UI framework.
- Toolbar inserts portable GFM syntax only. Preview additionally renders footnotes, `$math$` (KaTeX), and ` ```mermaid ` blocks.
- All preview HTML passes through DOMPurify before DOM insertion.
- Files are read/written UTF-8; dialogs filter `.md` / `.markdown` / `.txt`. Line endings are normalized CRLF→LF on open.
- Frontmatter is stripped from the editor; the panel owns it. Lines that are not flat `key: value` pairs are preserved verbatim — never destroyed. No YAML library.
- Editor content is never discarded on a failed save; file errors show a dismissible banner.
- `window.prompt()` does NOT exist in Electron renderers — URL entry must use the HTML `<dialog>` element (Task 8 provides it).
- Formatting functions operate on a plain state object `{ doc: string, from: number, to: number }` and return the same shape. They never touch CodeMirror.

## File Structure

```
package.json
.gitignore
src/
  main/main.js          Electron main: window, dialogs, file I/O, close guard
  preload.js            IPC bridge (window.markpad)
  renderer/
    index.html          Layout: toolbar, frontmatter panel, editor/preview area, status bar
    styles.css          All styling
    index.js            Entry point: wires modules, file state, imports CSS
    editor.js           CodeMirror setup + applyFormat adapter
    formatting.js       Pure formatting functions (unit-tested)
    frontmatter.js      Pure frontmatter split/parse/serialize/join (unit-tested)
    fmpanel.js          Frontmatter panel DOM component
    markdown.js         markdown-it pipeline + DOMPurify (unit-tested)
    preview.js          renderPreview: markdown.js output + Mermaid into a container
    ui.js               Toolbar wiring, view toggle, status bar, dialogs, error banner
tests/
  formatting.test.js
  frontmatter.test.js
  markdown.test.js
docs/superpowers/       (specs & plans, already present)
```

---

### Task 1: Project scaffold and hello window

**Files:**
- Create: `package.json`, `.gitignore`, `src/main/main.js`, `src/preload.js`, `src/renderer/index.html`, `src/renderer/index.js`, `src/renderer/styles.css`

**Interfaces:**
- Consumes: nothing
- Produces: `npm run build` (esbuild bundle to `dist/renderer.js` + `dist/renderer.css`), `npm start` (build + launch Electron), `npm test` (vitest). Window loads `src/renderer/index.html` which loads the bundle.

- [ ] **Step 1: Create package.json**

```json
{
  "name": "markpad",
  "version": "0.1.0",
  "description": "A small markdown editor with a formatting toolbar and live preview",
  "main": "src/main/main.js",
  "scripts": {
    "build": "esbuild src/renderer/index.js --bundle --outdir=dist --entry-names=renderer --format=iife --loader:.woff=file --loader:.woff2=file --loader:.ttf=file --asset-names=assets/[name]-[hash]",
    "start": "npm run build && electron .",
    "test": "vitest run"
  },
  "license": "MIT"
}
```

- [ ] **Step 2: Install dependencies**

Run:
```bash
npm install markdown-it markdown-it-footnote markdown-it-task-lists markdown-it-texmath katex dompurify mermaid codemirror @codemirror/view @codemirror/state @codemirror/lang-markdown
npm install --save-dev electron esbuild vitest jsdom
```
Expected: both commands exit 0; `package.json` gains `dependencies` and `devDependencies`.

- [ ] **Step 3: Create .gitignore**

```
node_modules/
dist/
```

- [ ] **Step 4: Create src/main/main.js (minimal window)**

```js
const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  return win;
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
```

- [ ] **Step 5: Create src/preload.js (empty bridge, filled in Task 10)**

```js
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('markpad', {});
```

- [ ] **Step 6: Create src/renderer/index.html (placeholder body, replaced in Task 8)**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:;" />
  <title>MarkPad</title>
  <link rel="stylesheet" href="../../dist/renderer.css" />
</head>
<body>
  <h1 id="hello">MarkPad scaffold OK</h1>
  <script src="../../dist/renderer.js"></script>
</body>
</html>
```

- [ ] **Step 7: Create src/renderer/index.js and src/renderer/styles.css**

`src/renderer/index.js`:
```js
import './styles.css';

console.log('MarkPad renderer loaded');
```

`src/renderer/styles.css`:
```css
:root {
  --bg: #ffffff;
  --fg: #1f2328;
  --border: #d0d7de;
  --accent: #0969da;
}

body {
  margin: 0;
  font-family: "Segoe UI", system-ui, sans-serif;
  color: var(--fg);
  background: var(--bg);
}
```

- [ ] **Step 8: Verify the app launches**

Run: `npm start`
Expected: build succeeds producing `dist/renderer.js` and `dist/renderer.css`; an Electron window opens showing "MarkPad scaffold OK". Close the window; the process exits.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json .gitignore src
git commit -m "feat: scaffold Electron app with esbuild renderer bundle"
```

---

### Task 2: Formatting engine — inline styles (TDD)

**Files:**
- Create: `src/renderer/formatting.js`, `tests/formatting.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `toggleInline(state, marker) -> state` where `state = { doc: string, from: number, to: number }` and `marker` is one of `'**'`, `'*'`, `'~~'`, `` '`' ``. Wraps the selection, or unwraps if already wrapped (markers inside or just outside the selection). Empty selection inserts the marker pair with the cursor between.

- [ ] **Step 1: Write failing tests**

`tests/formatting.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { toggleInline } from '../src/renderer/formatting.js';

describe('toggleInline', () => {
  it('wraps a selection in bold markers', () => {
    const r = toggleInline({ doc: 'hello world', from: 0, to: 5 }, '**');
    expect(r.doc).toBe('**hello** world');
    expect(r.from).toBe(2);
    expect(r.to).toBe(7);
  });

  it('unwraps when markers sit just outside the selection', () => {
    const r = toggleInline({ doc: '**hello** world', from: 2, to: 7 }, '**');
    expect(r.doc).toBe('hello world');
    expect(r.from).toBe(0);
    expect(r.to).toBe(5);
  });

  it('unwraps when markers are inside the selection', () => {
    const r = toggleInline({ doc: '**hello** world', from: 0, to: 9 }, '**');
    expect(r.doc).toBe('hello world');
    expect(r.from).toBe(0);
    expect(r.to).toBe(5);
  });

  it('inserts marker pair at cursor when selection is empty', () => {
    const r = toggleInline({ doc: 'ab', from: 1, to: 1 }, '**');
    expect(r.doc).toBe('a****b');
    expect(r.from).toBe(3);
    expect(r.to).toBe(3);
  });

  it('adds italic inside bold instead of stripping one star', () => {
    const r = toggleInline({ doc: '**bold**', from: 2, to: 6 }, '*');
    expect(r.doc).toBe('***bold***');
    expect(r.from).toBe(3);
    expect(r.to).toBe(7);
  });

  it('wraps with strikethrough and inline code markers', () => {
    expect(toggleInline({ doc: 'x', from: 0, to: 1 }, '~~').doc).toBe('~~x~~');
    expect(toggleInline({ doc: 'x', from: 0, to: 1 }, '`').doc).toBe('`x`');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/formatting.test.js`
Expected: FAIL — cannot resolve `../src/renderer/formatting.js` (file does not exist).

- [ ] **Step 3: Implement toggleInline**

`src/renderer/formatting.js`:
```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/formatting.test.js`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/formatting.js tests/formatting.test.js
git commit -m "feat: inline formatting toggles (bold/italic/strike/code)"
```

---

### Task 3: Formatting engine — block styles (TDD)

**Files:**
- Modify: `src/renderer/formatting.js`
- Modify: `tests/formatting.test.js`

**Interfaces:**
- Consumes: nothing new
- Produces:
  - `toggleHeading(state, level) -> state` (level 1–3; replaces an existing heading level, toggles off if already that level)
  - `toggleBlockquote(state) -> state` (adds/removes `> ` on each selected line)
  - `toggleList(state, type) -> state` (`type` is `'bullet' | 'ordered' | 'task'`; converts between list types; toggles off when all lines already match)
  - Cursor/selection is position-mapped through the per-line prefix edits.

- [ ] **Step 1: Write failing tests**

Append to `tests/formatting.test.js`:
```js
import {
  toggleHeading,
  toggleBlockquote,
  toggleList,
} from '../src/renderer/formatting.js';

describe('toggleHeading', () => {
  it('adds a heading prefix to the current line', () => {
    const r = toggleHeading({ doc: 'hello', from: 3, to: 3 }, 2);
    expect(r.doc).toBe('## hello');
    expect(r.from).toBe(6);
  });

  it('removes the prefix when the line already has that level', () => {
    const r = toggleHeading({ doc: '## hello', from: 6, to: 6 }, 2);
    expect(r.doc).toBe('hello');
    expect(r.from).toBe(3);
  });

  it('replaces a different heading level', () => {
    const r = toggleHeading({ doc: '# hello', from: 0, to: 0 }, 3);
    expect(r.doc).toBe('### hello');
  });

  it('only affects the line containing the cursor', () => {
    const r = toggleHeading({ doc: 'one\ntwo', from: 5, to: 5 }, 1);
    expect(r.doc).toBe('one\n# two');
  });
});

describe('toggleBlockquote', () => {
  it('quotes every selected line', () => {
    const r = toggleBlockquote({ doc: 'a\nb', from: 0, to: 3 });
    expect(r.doc).toBe('> a\n> b');
  });

  it('unquotes when all lines are quoted', () => {
    const r = toggleBlockquote({ doc: '> a\n> b', from: 0, to: 7 });
    expect(r.doc).toBe('a\nb');
  });

  it('skips empty lines when quoting', () => {
    const r = toggleBlockquote({ doc: 'a\n\nb', from: 0, to: 4 });
    expect(r.doc).toBe('> a\n\n> b');
  });
});

describe('toggleList', () => {
  it('makes selected lines a bullet list', () => {
    const r = toggleList({ doc: 'a\nb', from: 0, to: 3 }, 'bullet');
    expect(r.doc).toBe('- a\n- b');
  });

  it('numbers ordered lists sequentially', () => {
    const r = toggleList({ doc: 'a\nb\nc', from: 0, to: 5 }, 'ordered');
    expect(r.doc).toBe('1. a\n2. b\n3. c');
  });

  it('makes a task list', () => {
    const r = toggleList({ doc: 'a', from: 0, to: 1 }, 'task');
    expect(r.doc).toBe('- [ ] a');
  });

  it('converts bullet list to ordered list', () => {
    const r = toggleList({ doc: '- a\n- b', from: 0, to: 7 }, 'ordered');
    expect(r.doc).toBe('1. a\n2. b');
  });

  it('toggles off when all lines already match', () => {
    const r = toggleList({ doc: '- a\n- b', from: 0, to: 7 }, 'bullet');
    expect(r.doc).toBe('a\nb');
  });

  it('does not treat a task list as a bullet list', () => {
    const r = toggleList({ doc: '- [ ] a', from: 0, to: 7 }, 'bullet');
    expect(r.doc).toBe('- a');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/formatting.test.js`
Expected: FAIL — `toggleHeading` (etc.) is not exported.

- [ ] **Step 3: Implement block styles**

Append to `src/renderer/formatting.js`:
```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/formatting.test.js`
Expected: all tests PASS (6 inline + 13 block).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/formatting.js tests/formatting.test.js
git commit -m "feat: block formatting (headings, blockquote, lists)"
```

---

### Task 4: Formatting engine — inserts (TDD)

**Files:**
- Modify: `src/renderer/formatting.js`
- Modify: `tests/formatting.test.js`

**Interfaces:**
- Consumes: `lineRange` helper from Task 3
- Produces:
  - `insertLink(state, url) -> state` — selection becomes the link text, else placeholder `link text`; new selection covers the text portion
  - `insertImage(state, url) -> state` — like insertLink but `![alt](url)` with placeholder `alt`
  - `insertCodeBlock(state) -> state` — wraps selection in a fenced block on its own lines; cursor inside the fence when selection was empty
  - `insertTable(state) -> state` — inserts a 2×3 skeleton on its own lines
  - `insertHorizontalRule(state) -> state` — inserts `---` surrounded by blank lines (blank line before is required, or markdown parses it as a setext heading)

- [ ] **Step 1: Write failing tests**

Append to `tests/formatting.test.js`:
```js
import {
  insertLink,
  insertImage,
  insertCodeBlock,
  insertTable,
  insertHorizontalRule,
} from '../src/renderer/formatting.js';

describe('insertLink / insertImage', () => {
  it('uses the selection as link text', () => {
    const r = insertLink({ doc: 'see docs', from: 4, to: 8 }, 'https://x.com');
    expect(r.doc).toBe('see [docs](https://x.com)');
    expect(r.from).toBe(5);
    expect(r.to).toBe(9);
  });

  it('inserts placeholder text when selection is empty', () => {
    const r = insertLink({ doc: '', from: 0, to: 0 }, 'https://x.com');
    expect(r.doc).toBe('[link text](https://x.com)');
    expect(r.from).toBe(1);
    expect(r.to).toBe(10);
  });

  it('inserts an image with alt from selection', () => {
    const r = insertImage({ doc: 'cat', from: 0, to: 3 }, 'cat.png');
    expect(r.doc).toBe('![cat](cat.png)');
  });
});

describe('insertCodeBlock', () => {
  it('wraps the selection in a fence on its own lines', () => {
    const r = insertCodeBlock({ doc: 'code', from: 0, to: 4 });
    expect(r.doc).toBe('```\ncode\n```');
  });

  it('adds a leading newline when inserting mid-line', () => {
    const r = insertCodeBlock({ doc: 'text ', from: 5, to: 5 });
    expect(r.doc).toBe('text \n```\n\n```');
    expect(r.from).toBe(10); // cursor on the empty line inside the fence
    expect(r.to).toBe(10);
  });
});

describe('insertTable', () => {
  it('inserts a 2x3 skeleton on its own lines', () => {
    const r = insertTable({ doc: '', from: 0, to: 0 });
    expect(r.doc).toBe(
      '| Column 1 | Column 2 | Column 3 |\n' +
      '| -------- | -------- | -------- |\n' +
      '|          |          |          |\n'
    );
  });

  it('starts on a new line after existing text', () => {
    const r = insertTable({ doc: 'text', from: 4, to: 4 });
    expect(r.doc.startsWith('text\n| Column 1 |')).toBe(true);
  });
});

describe('insertHorizontalRule', () => {
  it('surrounds the rule with blank lines after text', () => {
    const r = insertHorizontalRule({ doc: 'text', from: 4, to: 4 });
    expect(r.doc).toBe('text\n\n---\n\n');
  });

  it('does not double blank lines in empty doc', () => {
    const r = insertHorizontalRule({ doc: '', from: 0, to: 0 });
    expect(r.doc).toBe('---\n\n');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/formatting.test.js`
Expected: FAIL — `insertLink` (etc.) is not exported.

- [ ] **Step 3: Implement inserts**

Append to `src/renderer/formatting.js`:
```js
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
  const block = `${lead}${FENCE}\n${selected}\n${FENCE}`;
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/formatting.test.js`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/formatting.js tests/formatting.test.js
git commit -m "feat: insert actions (link, image, code block, table, hr)"
```

---

### Task 5: Frontmatter core functions (TDD)

**Files:**
- Create: `src/renderer/frontmatter.js`, `tests/frontmatter.test.js`

**Interfaces:**
- Consumes: nothing
- Produces (all pure, no DOM, no YAML library):
  - `splitFrontmatter(doc: string) -> { fm: string | null, body: string }` — `fm` is the raw text between the `---` fences (fences excluded), `null` when the doc has no frontmatter. One blank separator line after the closing fence is absorbed.
  - `parseFrontmatter(fm: string) -> Array<{ key, value } | { raw }>` — flat `key: value` lines become `{ key, value }`; anything else (nested YAML, comments) becomes `{ raw: line }`, order preserved. Blank lines are dropped.
  - `serializeFrontmatter(rows) -> string` — inverse of parse; `{ raw }` rows are emitted verbatim.
  - `joinDoc(fm: string | null, body: string) -> string` — `null` returns the body unchanged; otherwise `---\n{fm}\n---\n\n{body}`.
  - `defaultFrontmatter(today: string) -> rows` — starter template: `title` (empty), `date` (the passed string), `tags` (`[]`).

- [ ] **Step 1: Write failing tests**

`tests/frontmatter.test.js`:
```js
import { describe, it, expect } from 'vitest';
import {
  splitFrontmatter,
  parseFrontmatter,
  serializeFrontmatter,
  joinDoc,
  defaultFrontmatter,
} from '../src/renderer/frontmatter.js';

describe('splitFrontmatter', () => {
  it('returns null fm when the doc has none', () => {
    expect(splitFrontmatter('# hi')).toEqual({ fm: null, body: '# hi' });
  });

  it('splits fm and body', () => {
    expect(splitFrontmatter('---\ntitle: x\n---\n\n# hi')).toEqual({
      fm: 'title: x',
      body: '# hi',
    });
  });

  it('treats an unclosed fence as plain body', () => {
    expect(splitFrontmatter('---\ntitle: x')).toEqual({
      fm: null,
      body: '---\ntitle: x',
    });
  });

  it('does not require a blank line after the block', () => {
    expect(splitFrontmatter('---\na: 1\n---\nbody')).toEqual({
      fm: 'a: 1',
      body: 'body',
    });
  });
});

describe('parseFrontmatter', () => {
  it('parses flat key-value pairs', () => {
    expect(parseFrontmatter('title: x\ndate: 2026-07-07')).toEqual([
      { key: 'title', value: 'x' },
      { key: 'date', value: '2026-07-07' },
    ]);
  });

  it('preserves non-pair lines as raw rows in order', () => {
    expect(parseFrontmatter('tags:\n  - a\n# comment')).toEqual([
      { key: 'tags', value: '' },
      { raw: '  - a' },
      { raw: '# comment' },
    ]);
  });
});

describe('serializeFrontmatter', () => {
  it('round-trips parse -> serialize including raw rows', () => {
    const src = 'title: x\ntags:\n  - a';
    expect(serializeFrontmatter(parseFrontmatter(src))).toBe(src);
  });
});

describe('joinDoc', () => {
  it('returns the body alone when fm is null', () => {
    expect(joinDoc(null, '# hi')).toBe('# hi');
  });

  it('joins with fences and a blank separator line', () => {
    expect(joinDoc('a: 1', 'body')).toBe('---\na: 1\n---\n\nbody');
  });

  it('split(join(fm, body)) round-trips', () => {
    expect(splitFrontmatter(joinDoc('a: 1', 'body'))).toEqual({
      fm: 'a: 1',
      body: 'body',
    });
  });
});

describe('defaultFrontmatter', () => {
  it('provides a title/date/tags template', () => {
    expect(defaultFrontmatter('2026-07-07')).toEqual([
      { key: 'title', value: '' },
      { key: 'date', value: '2026-07-07' },
      { key: 'tags', value: '[]' },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/frontmatter.test.js`
Expected: FAIL — cannot resolve `../src/renderer/frontmatter.js`.

- [ ] **Step 3: Implement the module**

`src/renderer/frontmatter.js`:
```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/frontmatter.test.js`
Expected: all 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/frontmatter.js tests/frontmatter.test.js
git commit -m "feat: frontmatter split/parse/serialize/join core"
```

---

### Task 6: Markdown render pipeline (TDD)

**Files:**
- Create: `src/renderer/markdown.js`, `tests/markdown.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `renderMarkdown(source: string) -> string` — sanitized HTML implementing GFM (tables, task lists, strikethrough, autolinks) plus footnotes and KaTeX math. Mermaid blocks come through as `<pre><code class="language-mermaid">` for Task 8 to render. This module must NOT import mermaid or any CSS (it runs under jsdom in tests).

- [ ] **Step 1: Write failing tests**

`tests/markdown.test.js`:
```js
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../src/renderer/markdown.js';

describe('renderMarkdown', () => {
  it('renders GFM tables', () => {
    const html = renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |');
    expect(html).toContain('<table>');
  });

  it('renders strikethrough', () => {
    expect(renderMarkdown('~~gone~~')).toContain('<s>');
  });

  it('renders task list checkboxes', () => {
    const html = renderMarkdown('- [x] done\n- [ ] todo');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked');
  });

  it('autolinks bare URLs', () => {
    expect(renderMarkdown('see https://example.com today')).toContain('<a href="https://example.com"');
  });

  it('renders footnotes', () => {
    const html = renderMarkdown('text[^1]\n\n[^1]: the note');
    expect(html).toContain('footnote');
  });

  it('renders inline math with KaTeX', () => {
    expect(renderMarkdown('$x^2$')).toContain('katex');
  });

  it('strips script tags', () => {
    const html = renderMarkdown('hello <script>alert(1)</script>');
    expect(html).not.toContain('<script');
  });

  it('strips event handler attributes', () => {
    const html = renderMarkdown('<img src="x.png" onerror="alert(1)">');
    expect(html).not.toContain('onerror');
  });

  it('leaves mermaid blocks as language-mermaid code', () => {
    const html = renderMarkdown('```mermaid\ngraph TD; A-->B;\n```');
    expect(html).toContain('language-mermaid');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/markdown.test.js`
Expected: FAIL — cannot resolve `../src/renderer/markdown.js`.

- [ ] **Step 3: Implement the pipeline**

`src/renderer/markdown.js`:
```js
import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';
import texmath from 'markdown-it-texmath';
import katex from 'katex';
import DOMPurify from 'dompurify';

const md = new MarkdownIt({ html: true, linkify: true })
  .use(footnote)
  .use(taskLists)
  .use(texmath, {
    engine: katex,
    delimiters: 'dollars',
    katexOptions: { throwOnError: false },
  });

export function renderMarkdown(source) {
  return DOMPurify.sanitize(md.render(source));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/markdown.test.js`
Expected: all 9 tests PASS.

- [ ] **Step 5: Run the whole suite and commit**

Run: `npm test`
Expected: formatting + frontmatter + markdown suites all PASS.

```bash
git add src/renderer/markdown.js tests/markdown.test.js
git commit -m "feat: markdown-it pipeline with GFM, footnotes, KaTeX, DOMPurify"
```

---

### Task 7: Editor pane (CodeMirror)

**Files:**
- Create: `src/renderer/editor.js`
- Modify: `src/renderer/index.js`, `src/renderer/index.html`, `src/renderer/styles.css`

**Interfaces:**
- Consumes: formatting functions from Tasks 2–4 (applied externally, not here)
- Produces:
  - `createEditor(parent: HTMLElement, onChange: () => void) -> EditorView` — CodeMirror 6 with markdown highlighting, line wrapping, undo history; `onChange` fires on doc or selection change
  - `applyFormat(view, fn, ...args)` — reads `{ doc, from, to }`, calls `fn(state, ...args)`, dispatches one transaction (undo-friendly), refocuses the editor
  - `getDoc(view) -> string`, `setDoc(view, text)` — used by file actions in Task 10

- [ ] **Step 1: Create src/renderer/editor.js**

```js
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';

export function createEditor(parent, onChange) {
  return new EditorView({
    parent,
    extensions: [
      basicSetup,
      markdown({ base: markdownLanguage }),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged || update.selectionSet) onChange();
      }),
    ],
  });
}

export function applyFormat(view, fn, ...args) {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc.toString();
  const result = fn({ doc, from, to }, ...args);
  view.dispatch({
    changes: { from: 0, to: doc.length, insert: result.doc },
    selection: { anchor: result.from, head: result.to },
  });
  view.focus();
}

export function getDoc(view) {
  return view.state.doc.toString();
}

export function setDoc(view, text) {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: 0 },
  });
}
```

- [ ] **Step 2: Mount the editor**

Replace the `<body>` of `src/renderer/index.html`:
```html
<body>
  <main id="editor-pane"></main>
  <script src="../../dist/renderer.js"></script>
</body>
```

Replace `src/renderer/index.js`:
```js
import './styles.css';
import { createEditor } from './editor.js';

const view = createEditor(document.getElementById('editor-pane'), () => {});
view.focus();
```

Append to `src/renderer/styles.css`:
```css
#editor-pane {
  height: 100vh;
}

.cm-editor {
  height: 100%;
  font-size: 15px;
}

.cm-editor.cm-focused {
  outline: none;
}
```

- [ ] **Step 3: Verify manually**

Run: `npm start`
Expected: the window shows a CodeMirror editor. Typing `# Hello` shows heading syntax highlighting; `**bold**` highlights the markers; Ctrl+Z undoes typing.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/editor.js src/renderer/index.js src/renderer/index.html src/renderer/styles.css
git commit -m "feat: CodeMirror markdown editor pane"
```

---

### Task 8: Toolbar, view toggle, preview, status bar

**Files:**
- Create: `src/renderer/preview.js`, `src/renderer/ui.js`
- Modify: `src/renderer/index.html`, `src/renderer/styles.css`, `src/renderer/index.js`

**Interfaces:**
- Consumes: `createEditor` / `applyFormat` / `getDoc` (Task 7), all formatting functions (Tasks 2–4), `renderMarkdown` (Task 6)
- Produces:
  - `renderPreview(container: HTMLElement, source: string) -> Promise<void>` (preview.js) — sanitized HTML into container, then renders each `language-mermaid` block to SVG; a failing block becomes a `.preview-error` box, the rest of the document still renders
  - `initUI(view) -> { showError(message), setStatusFile(name, dirty), updateStatus() }` (ui.js) — wires toolbar clicks, keyboard shortcuts, Edit/Preview toggle (preserving editor scroll), status bar, URL dialog, error banner. File actions (`new`, `open`, `save`) are stubs in this task; Task 10 fills them via `registerFileActions(handlers)`.

- [ ] **Step 1: Create the full layout**

Replace the `<body>` of `src/renderer/index.html`:
```html
<body>
  <div id="error-banner" class="hidden">
    <span id="error-message"></span>
    <button id="error-dismiss" title="Dismiss">✕</button>
  </div>

  <header id="toolbar">
    <div class="group">
      <button data-action="new" title="New (Ctrl+N)">New</button>
      <button data-action="open" title="Open (Ctrl+O)">Open</button>
      <button data-action="save" title="Save (Ctrl+S)">Save</button>
    </div>
    <div class="group">
      <button data-action="h1" title="Heading 1">H1</button>
      <button data-action="h2" title="Heading 2">H2</button>
      <button data-action="h3" title="Heading 3">H3</button>
    </div>
    <div class="group">
      <button data-action="bold" title="Bold (Ctrl+B)"><b>B</b></button>
      <button data-action="italic" title="Italic (Ctrl+I)"><i>I</i></button>
      <button data-action="strike" title="Strikethrough"><s>S</s></button>
      <button data-action="code" title="Inline code">&lt;/&gt;</button>
      <button data-action="codeblock" title="Code block">{ }</button>
    </div>
    <div class="group">
      <button data-action="link" title="Link (Ctrl+K)">🔗</button>
      <button data-action="image" title="Image">🖼</button>
    </div>
    <div class="group">
      <button data-action="quote" title="Blockquote">❝</button>
      <button data-action="bullet" title="Bullet list">•</button>
      <button data-action="ordered" title="Numbered list">1.</button>
      <button data-action="task" title="Task list">☑</button>
    </div>
    <div class="group">
      <button data-action="table" title="Table">⊞</button>
      <button data-action="hr" title="Horizontal rule">―</button>
    </div>
    <div class="spacer"></div>
    <div class="group" id="mode-toggle">
      <button id="mode-edit" class="active" title="Edit (Ctrl+E)">Edit</button>
      <button id="mode-preview" title="Preview (Ctrl+E)">Preview</button>
    </div>
  </header>

  <main id="content">
    <div id="editor-pane"></div>
    <div id="preview-pane" class="hidden"></div>
  </main>

  <footer id="status-bar">
    <span id="status-file">untitled.md</span>
    <span class="spacer"></span>
    <span id="status-words">0 words</span>
    <span id="status-line">Ln 1</span>
  </footer>

  <dialog id="url-dialog">
    <form method="dialog">
      <label id="url-label" for="url-input">URL</label>
      <input id="url-input" type="text" placeholder="https://" autofocus />
      <div class="dialog-buttons">
        <button value="cancel">Cancel</button>
        <button value="ok" id="url-ok">Insert</button>
      </div>
    </form>
  </dialog>

  <script src="../../dist/renderer.js"></script>
</body>
```

- [ ] **Step 2: Style the layout**

Append to `src/renderer/styles.css`:
```css
body {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.hidden { display: none !important; }

#error-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: #ffebe9;
  border-bottom: 1px solid #ff8182;
  color: #a40e26;
}
#error-banner button {
  margin-left: auto;
  background: none;
  border: none;
  cursor: pointer;
  color: inherit;
}

#toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  background: #f6f8fa;
  user-select: none;
}
#toolbar .group {
  display: flex;
  gap: 2px;
  padding: 0 6px;
  border-right: 1px solid var(--border);
}
#toolbar .group:last-child { border-right: none; }
#toolbar .spacer { flex: 1; border: none; }
#toolbar button {
  min-width: 30px;
  padding: 4px 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  font-size: 13px;
  cursor: pointer;
}
#toolbar button:hover { background: #eaeef2; border-color: var(--border); }
#mode-toggle button.active {
  background: var(--accent);
  color: white;
}

#content {
  flex: 1;
  min-height: 0;
}
#editor-pane { height: 100%; }
#preview-pane {
  height: 100%;
  overflow-y: auto;
  padding: 16px 32px;
  box-sizing: border-box;
  max-width: 900px;
}
#preview-pane table { border-collapse: collapse; }
#preview-pane th, #preview-pane td {
  border: 1px solid var(--border);
  padding: 4px 12px;
}
#preview-pane blockquote {
  margin-left: 0;
  padding-left: 12px;
  border-left: 4px solid var(--border);
  color: #57606a;
}
#preview-pane pre {
  background: #f6f8fa;
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
}
#preview-pane code { font-family: Consolas, monospace; }
.preview-error {
  border: 1px solid #ff8182;
  background: #ffebe9;
  color: #a40e26;
  padding: 8px 12px;
  border-radius: 6px;
  font-family: Consolas, monospace;
  white-space: pre-wrap;
}

#status-bar {
  display: flex;
  gap: 16px;
  padding: 4px 12px;
  border-top: 1px solid var(--border);
  background: #f6f8fa;
  font-size: 12px;
  color: #57606a;
}
#status-bar .spacer { flex: 1; }

#url-dialog {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  min-width: 360px;
}
#url-dialog::backdrop { background: rgba(0, 0, 0, 0.3); }
#url-dialog form { display: flex; flex-direction: column; gap: 10px; }
#url-dialog input { padding: 6px 8px; font-size: 14px; }
.dialog-buttons { display: flex; justify-content: flex-end; gap: 8px; }
```

- [ ] **Step 3: Create src/renderer/preview.js**

```js
import mermaid from 'mermaid';
import { renderMarkdown } from './markdown.js';

mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });

let mermaidCounter = 0;

export async function renderPreview(container, source) {
  container.innerHTML = renderMarkdown(source);
  const blocks = container.querySelectorAll('pre > code.language-mermaid');
  for (const code of blocks) {
    const div = document.createElement('div');
    const src = code.textContent;
    code.parentElement.replaceWith(div);
    try {
      const { svg } = await mermaid.render(`mermaid-${mermaidCounter++}`, src);
      div.innerHTML = svg;
    } catch (err) {
      div.className = 'preview-error';
      div.textContent = `Mermaid error: ${err.message}`;
    }
  }
}
```

- [ ] **Step 4: Create src/renderer/ui.js**

```js
import * as fmt from './formatting.js';
import { applyFormat, getDoc } from './editor.js';
import { renderPreview } from './preview.js';

// Filled in by registerFileActions (Task 10). Until then, no-ops.
let fileActions = { newFile() {}, openFile() {}, save() {}, saveAs() {} };

export function registerFileActions(handlers) {
  fileActions = handlers;
}

export function initUI(view) {
  const editorPane = document.getElementById('editor-pane');
  const previewPane = document.getElementById('preview-pane');
  const modeEdit = document.getElementById('mode-edit');
  const modePreview = document.getElementById('mode-preview');
  const banner = document.getElementById('error-banner');
  const bannerMsg = document.getElementById('error-message');
  const urlDialog = document.getElementById('url-dialog');
  const urlInput = document.getElementById('url-input');
  const urlLabel = document.getElementById('url-label');

  // --- error banner ---
  function showError(message) {
    bannerMsg.textContent = message;
    banner.classList.remove('hidden');
  }
  document.getElementById('error-dismiss').addEventListener('click', () => {
    banner.classList.add('hidden');
  });

  // --- URL dialog (window.prompt does not exist in Electron) ---
  function askUrl(label) {
    return new Promise((resolve) => {
      urlLabel.textContent = label;
      urlInput.value = '';
      urlDialog.returnValue = 'cancel';
      urlDialog.showModal();
      urlDialog.addEventListener(
        'close',
        () => resolve(urlDialog.returnValue === 'ok' ? urlInput.value.trim() : null),
        { once: true }
      );
    });
  }

  async function insertUrl(kind) {
    const url = await askUrl(kind === 'link' ? 'Link URL' : 'Image URL');
    if (!url) { view.focus(); return; }
    applyFormat(view, kind === 'link' ? fmt.insertLink : fmt.insertImage, url);
  }

  // --- view toggle ---
  let mode = 'edit';
  let savedScrollTop = 0;

  async function setMode(next) {
    if (next === mode) return;
    mode = next;
    modeEdit.classList.toggle('active', mode === 'edit');
    modePreview.classList.toggle('active', mode === 'preview');
    if (mode === 'preview') {
      savedScrollTop = view.scrollDOM.scrollTop;
      await renderPreview(previewPane, getDoc(view));
      editorPane.classList.add('hidden');
      previewPane.classList.remove('hidden');
    } else {
      previewPane.classList.add('hidden');
      editorPane.classList.remove('hidden');
      view.scrollDOM.scrollTop = savedScrollTop;
      view.focus();
    }
  }

  modeEdit.addEventListener('click', () => setMode('edit'));
  modePreview.addEventListener('click', () => setMode('preview'));

  // --- toolbar actions ---
  const actions = {
    new: () => fileActions.newFile(),
    open: () => fileActions.openFile(),
    save: () => fileActions.save(),
    h1: () => applyFormat(view, fmt.toggleHeading, 1),
    h2: () => applyFormat(view, fmt.toggleHeading, 2),
    h3: () => applyFormat(view, fmt.toggleHeading, 3),
    bold: () => applyFormat(view, fmt.toggleInline, '**'),
    italic: () => applyFormat(view, fmt.toggleInline, '*'),
    strike: () => applyFormat(view, fmt.toggleInline, '~~'),
    code: () => applyFormat(view, fmt.toggleInline, '`'),
    codeblock: () => applyFormat(view, fmt.insertCodeBlock),
    link: () => insertUrl('link'),
    image: () => insertUrl('image'),
    quote: () => applyFormat(view, fmt.toggleBlockquote),
    bullet: () => applyFormat(view, fmt.toggleList, 'bullet'),
    ordered: () => applyFormat(view, fmt.toggleList, 'ordered'),
    task: () => applyFormat(view, fmt.toggleList, 'task'),
    table: () => applyFormat(view, fmt.insertTable),
    hr: () => applyFormat(view, fmt.insertHorizontalRule),
  };

  document.getElementById('toolbar').addEventListener('click', (e) => {
    const action = e.target.closest('button')?.dataset.action;
    if (action && actions[action]) actions[action]();
  });

  // --- keyboard shortcuts ---
  window.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    const shortcuts = {
      b: actions.bold,
      i: actions.italic,
      k: actions.link,
      e: () => setMode(mode === 'edit' ? 'preview' : 'edit'),
      n: actions.new,
      o: actions.open,
      s: e.shiftKey ? () => fileActions.saveAs() : actions.save,
    };
    if (shortcuts[key]) {
      e.preventDefault();
      shortcuts[key]();
    }
  });

  // --- status bar ---
  const statusFile = document.getElementById('status-file');
  const statusWords = document.getElementById('status-words');
  const statusLine = document.getElementById('status-line');

  function updateStatus() {
    const doc = getDoc(view);
    const words = doc.split(/\s+/).filter(Boolean).length;
    statusWords.textContent = `${words} words`;
    const line = view.state.doc.lineAt(view.state.selection.main.head).number;
    statusLine.textContent = `Ln ${line}`;
  }

  function setStatusFile(name, dirty) {
    statusFile.textContent = dirty ? `${name} ●` : name;
    document.title = dirty ? `${name} ● — MarkPad` : `${name} — MarkPad`;
  }

  updateStatus();
  setStatusFile('untitled.md', false);

  return { showError, setStatusFile, updateStatus };
}
```

- [ ] **Step 5: Wire everything in index.js**

Replace `src/renderer/index.js`:
```js
import './styles.css';
import 'katex/dist/katex.min.css';
import { createEditor } from './editor.js';
import { initUI } from './ui.js';

let ui;
const view = createEditor(document.getElementById('editor-pane'), () => {
  if (ui) ui.updateStatus();
});
ui = initUI(view);
view.focus();
```

- [ ] **Step 6: Verify manually**

Run: `npm start`. Check each of:
- Every toolbar button inserts/toggles the right syntax; Bold twice on the same selection returns the original text.
- Link button opens the URL dialog (not a frozen window — `window.prompt` would throw); Cancel inserts nothing.
- `Ctrl+B`, `Ctrl+I`, `Ctrl+E` work; `Ctrl+E` toggles Edit/Preview.
- In Preview: type a table, task list, `$x^2$`, a footnote, and a ` ```mermaid ` block with `graph TD; A-->B;` — all render; a mermaid block with garbage shows a red error box while the rest still renders.
- Switching Preview → Edit restores cursor and scroll position.
- Status bar shows live word count and line number.

- [ ] **Step 7: Commit**

```bash
git add src/renderer
git commit -m "feat: toolbar, edit/preview toggle, preview pipeline, status bar"
```

---

### Task 9: Frontmatter panel component

**Files:**
- Create: `src/renderer/fmpanel.js`
- Modify: `src/renderer/index.html`, `src/renderer/styles.css`, `src/renderer/index.js`

**Interfaces:**
- Consumes: `parseFrontmatter`, `serializeFrontmatter`, `defaultFrontmatter` (Task 5)
- Produces: `createFrontmatterPanel(root: HTMLElement, onChange: () => void) -> panel` where:
  - `panel.setFrontmatter(fm: string | null)` — load state; `null` shows the "+ Add frontmatter" bar; a string parses into rows, collapsed by default
  - `panel.getFrontmatter() -> string | null` — serialize current rows, or `null` when the document has no frontmatter
  - `onChange` fires on every user edit (typing in fields, add/remove row, add/remove frontmatter) — Task 10 uses it for dirty tracking

- [ ] **Step 1: Add the panel section to index.html**

In `src/renderer/index.html`, insert between `</header>` and `<main id="content">`:
```html
  <section id="fm-panel"></section>
```

- [ ] **Step 2: Style the panel**

Append to `src/renderer/styles.css`:
```css
#fm-panel {
  border-bottom: 1px solid var(--border);
  background: #fbfcfd;
  font-size: 13px;
}
#fm-panel:empty { display: none; }
#fm-add {
  margin: 4px 8px;
  padding: 2px 8px;
  border: none;
  background: none;
  color: var(--accent);
  cursor: pointer;
  font-size: 12px;
}
.fm-header {
  display: flex;
  align-items: center;
  padding: 4px 8px;
}
.fm-header button {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 13px;
  padding: 2px 6px;
}
.fm-header .fm-remove {
  margin-left: auto;
  color: #a40e26;
  font-size: 12px;
}
.fm-rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 12px 8px;
  max-height: 40vh;
  overflow-y: auto;
}
.fm-row { display: flex; gap: 6px; align-items: center; }
.fm-row input {
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 13px;
}
.fm-key { width: 140px; }
.fm-value { flex: 1; }
.fm-row button {
  border: none;
  background: none;
  cursor: pointer;
  color: #57606a;
}
.fm-raw {
  font-family: Consolas, monospace;
  color: #57606a;
  padding: 3px 6px;
}
.fm-add-prop {
  align-self: flex-start;
  border: none;
  background: none;
  color: var(--accent);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 6px;
}
```

- [ ] **Step 3: Create src/renderer/fmpanel.js**

```js
import {
  parseFrontmatter,
  serializeFrontmatter,
  defaultFrontmatter,
} from './frontmatter.js';

export function createFrontmatterPanel(root, onChange) {
  let rows = null; // null = document has no frontmatter
  let collapsed = true;

  function pairCount() {
    return rows.filter((r) => r.raw === undefined).length;
  }

  function render() {
    root.innerHTML = '';

    if (rows === null) {
      const add = document.createElement('button');
      add.id = 'fm-add';
      add.textContent = '+ Add frontmatter';
      add.addEventListener('click', () => {
        const today = new Date().toISOString().slice(0, 10);
        rows = defaultFrontmatter(today);
        collapsed = false;
        render();
        onChange();
      });
      root.appendChild(add);
      return;
    }

    const header = document.createElement('div');
    header.className = 'fm-header';
    const toggle = document.createElement('button');
    toggle.textContent = `${collapsed ? '▸' : '▾'} Frontmatter (${pairCount()})`;
    toggle.addEventListener('click', () => {
      collapsed = !collapsed;
      render();
    });
    const remove = document.createElement('button');
    remove.className = 'fm-remove';
    remove.textContent = 'Remove frontmatter';
    remove.addEventListener('click', () => {
      rows = null;
      render();
      onChange();
    });
    header.append(toggle, remove);
    root.appendChild(header);

    if (collapsed) return;

    const list = document.createElement('div');
    list.className = 'fm-rows';
    rows.forEach((row, i) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'fm-row';
      if (row.raw !== undefined) {
        const raw = document.createElement('code');
        raw.className = 'fm-raw';
        raw.textContent = row.raw;
        rowEl.appendChild(raw);
      } else {
        const key = document.createElement('input');
        key.className = 'fm-key';
        key.placeholder = 'key';
        key.value = row.key;
        key.addEventListener('input', () => {
          row.key = key.value;
          onChange();
        });
        const value = document.createElement('input');
        value.className = 'fm-value';
        value.placeholder = 'value';
        value.value = row.value;
        value.addEventListener('input', () => {
          row.value = value.value;
          onChange();
        });
        const del = document.createElement('button');
        del.textContent = '✕';
        del.title = 'Remove property';
        del.addEventListener('click', () => {
          rows.splice(i, 1);
          render();
          onChange();
        });
        rowEl.append(key, value, del);
      }
      list.appendChild(rowEl);
    });

    const addProp = document.createElement('button');
    addProp.className = 'fm-add-prop';
    addProp.textContent = '+ Add property';
    addProp.addEventListener('click', () => {
      rows.push({ key: '', value: '' });
      render();
      const keys = root.querySelectorAll('.fm-key');
      keys[keys.length - 1].focus();
      onChange();
    });
    list.appendChild(addProp);
    root.appendChild(list);
  }

  render();

  return {
    setFrontmatter(fm) {
      rows = fm === null ? null : parseFrontmatter(fm);
      collapsed = true;
      render();
    },
    getFrontmatter() {
      if (rows === null) return null;
      return serializeFrontmatter(rows);
    },
  };
}
```

- [ ] **Step 4: Mount the panel in index.js**

Replace `src/renderer/index.js` (dirty tracking arrives in Task 10 — the panel's `onChange` is a no-op for now):
```js
import './styles.css';
import 'katex/dist/katex.min.css';
import { createEditor } from './editor.js';
import { initUI } from './ui.js';
import { createFrontmatterPanel } from './fmpanel.js';

let ui;
const view = createEditor(document.getElementById('editor-pane'), () => {
  if (ui) ui.updateStatus();
});
ui = initUI(view);
const fmPanel = createFrontmatterPanel(
  document.getElementById('fm-panel'),
  () => {}
);
view.focus();
```

- [ ] **Step 5: Run the unit tests (regression check)**

Run: `npm test`
Expected: all suites still PASS.

- [ ] **Step 6: Verify manually**

Run: `npm start`. Check each of:
- A slim "+ Add frontmatter" bar sits between toolbar and editor.
- Clicking it shows an expanded panel with `title` (empty), `date` (today), `tags` (`[]`) rows.
- The chevron collapses to `▸ Frontmatter (3)` and back.
- "+ Add property" appends an empty row and focuses its key field; ✕ removes a row; "Remove frontmatter" returns to the "+ Add frontmatter" bar.
- The panel stays visible when switching to Preview mode.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/fmpanel.js src/renderer/index.html src/renderer/styles.css src/renderer/index.js
git commit -m "feat: collapsible frontmatter key-value panel"
```

---

### Task 10: File I/O, frontmatter round trip, dirty tracking, close guard

**Files:**
- Modify: `src/main/main.js`, `src/preload.js`, `src/renderer/index.js`

**Interfaces:**
- Consumes: `registerFileActions(handlers)`, `showError`, `setStatusFile` (Task 8); `getDoc` / `setDoc` (Task 7); `splitFrontmatter` / `joinDoc` (Task 5); `createFrontmatterPanel` (Task 9)
- Produces `window.markpad` bridge:
  - `openFile() -> Promise<{ path, name, content } | { error } | null>` (null = cancelled)
  - `saveFile(path, content) -> Promise<{ ok: true } | { ok: false, error }>`
  - `saveFileAs(content) -> Promise<{ ok: true, path, name } | { ok: false, error } | null>`
  - `confirmUnsaved() -> Promise<0 | 1 | 2>` (0 = Save, 1 = Don't Save, 2 = Cancel)
  - `onCloseRequested(cb)`, `confirmClose()`
- The saved document on disk is always `joinDoc(panel frontmatter, editor body)`.

- [ ] **Step 1: Replace src/main/main.js**

```js
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');

const FILE_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown'] },
  { name: 'Text', extensions: ['txt'] },
  { name: 'All Files', extensions: ['*'] },
];

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Close guard: the renderer owns dirty state. Ask it before closing;
  // it replies with 'close-confirmed' once the user has decided.
  let closeConfirmed = false;
  win.on('close', (e) => {
    if (!closeConfirmed) {
      e.preventDefault();
      win.webContents.send('close-requested');
    }
  });
  ipcMain.on('close-confirmed', () => {
    closeConfirmed = true;
    win.close();
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  return win;
}

ipcMain.handle('dialog:open', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    filters: FILE_FILTERS,
    properties: ['openFile'],
  });
  if (canceled || filePaths.length === 0) return null;
  const filePath = filePaths[0];
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return { path: filePath, name: path.basename(filePath), content };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('file:save', async (_event, filePath, content) => {
  try {
    await fs.writeFile(filePath, content, 'utf-8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('dialog:saveAs', async (_event, content) => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    filters: FILE_FILTERS,
    defaultPath: 'untitled.md',
  });
  if (canceled || !filePath) return null;
  try {
    await fs.writeFile(filePath, content, 'utf-8');
    return { ok: true, path: filePath, name: path.basename(filePath) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('dialog:confirmUnsaved', async () => {
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    message: 'You have unsaved changes.',
    detail: 'Do you want to save them?',
  });
  return response;
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
```

- [ ] **Step 2: Replace src/preload.js**

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('markpad', {
  openFile: () => ipcRenderer.invoke('dialog:open'),
  saveFile: (path, content) => ipcRenderer.invoke('file:save', path, content),
  saveFileAs: (content) => ipcRenderer.invoke('dialog:saveAs', content),
  confirmUnsaved: () => ipcRenderer.invoke('dialog:confirmUnsaved'),
  onCloseRequested: (cb) => ipcRenderer.on('close-requested', cb),
  confirmClose: () => ipcRenderer.send('close-confirmed'),
});
```

- [ ] **Step 3: Replace src/renderer/index.js (file state + frontmatter round trip)**

```js
import './styles.css';
import 'katex/dist/katex.min.css';
import { createEditor, getDoc, setDoc } from './editor.js';
import { initUI, registerFileActions } from './ui.js';
import { createFrontmatterPanel } from './fmpanel.js';
import { splitFrontmatter, joinDoc } from './frontmatter.js';

let ui;
let fmPanel;
let currentPath = null;
let currentName = 'untitled.md';
let savedDoc = '';

const view = createEditor(document.getElementById('editor-pane'), () => {
  if (!ui) return;
  ui.updateStatus();
  refreshTitle();
});
ui = initUI(view);
fmPanel = createFrontmatterPanel(document.getElementById('fm-panel'), () =>
  refreshTitle()
);

// The document on disk = frontmatter block (panel) + body (editor).
function fullDoc() {
  return joinDoc(fmPanel.getFrontmatter(), getDoc(view));
}

function isDirty() {
  return fullDoc() !== savedDoc;
}

function refreshTitle() {
  if (!ui || !fmPanel) return;
  ui.setStatusFile(currentName, isDirty());
}

function markSaved(pathOrNull, name) {
  currentPath = pathOrNull;
  currentName = name;
  savedDoc = fullDoc();
  refreshTitle();
}

// Returns true if it is safe to discard the current buffer.
async function guardDirty() {
  if (!isDirty()) return true;
  const choice = await window.markpad.confirmUnsaved();
  if (choice === 2) return false; // Cancel
  if (choice === 0) return save(); // Save; abort if the save fails/cancels
  return true; // Don't Save
}

async function newFile() {
  if (!(await guardDirty())) return;
  fmPanel.setFrontmatter(null);
  setDoc(view, '');
  markSaved(null, 'untitled.md');
  view.focus();
}

async function openFile() {
  if (!(await guardDirty())) return;
  const result = await window.markpad.openFile();
  if (!result) return;
  if (result.error) {
    ui.showError(`Could not open file: ${result.error}`);
    return;
  }
  const normalized = result.content.replace(/\r\n/g, '\n');
  const { fm, body } = splitFrontmatter(normalized);
  fmPanel.setFrontmatter(fm);
  setDoc(view, body);
  markSaved(result.path, result.name);
  view.focus();
}

async function save() {
  if (!currentPath) return saveAs();
  const result = await window.markpad.saveFile(currentPath, fullDoc());
  if (!result.ok) {
    ui.showError(`Could not save file: ${result.error}`);
    return false;
  }
  markSaved(currentPath, currentName);
  return true;
}

async function saveAs() {
  const result = await window.markpad.saveFileAs(fullDoc());
  if (!result) return false; // cancelled
  if (!result.ok) {
    ui.showError(`Could not save file: ${result.error}`);
    return false;
  }
  markSaved(result.path, result.name);
  return true;
}

registerFileActions({ newFile, openFile, save, saveAs });

window.markpad.onCloseRequested(async () => {
  if (await guardDirty()) window.markpad.confirmClose();
});

refreshTitle();
view.focus();
```

- [ ] **Step 4: Run the unit tests (regression check)**

Run: `npm test`
Expected: all suites still PASS.

- [ ] **Step 5: Verify manually**

Run: `npm start`. Check each of:
- Type text → status bar and title show `●`; Save opens Save As dialog (no path yet); after saving, `●` clears and the filename appears.
- Edit again → `●` returns; `Ctrl+S` saves silently to the same path.
- `Ctrl+Shift+S` always opens Save As.
- Open (`Ctrl+O`) an existing `.md` file → content loads, name shown.
- **Frontmatter round trip:** open a file that starts with a `---` block → the block does NOT appear in the editor; the panel shows `▸ Frontmatter (n)` collapsed. Expand, edit a value → `●` appears. Save, then open the file in Notepad → the YAML block is at the top with your edit, body intact.
- **Nested YAML preserved:** a file with `tags:` followed by indented `- a` lines shows those lines as read-only rows and writes them back unchanged.
- Adding frontmatter via the panel to a plain file and saving writes the block; "Remove frontmatter" + save removes it from disk.
- With unsaved changes (editor OR panel): New, Open, and closing the window each prompt Save / Don't Save / Cancel. Cancel aborts; Don't Save proceeds; Save writes then proceeds.

- [ ] **Step 6: Commit**

```bash
git add src/main/main.js src/preload.js src/renderer/index.js
git commit -m "feat: file open/save with frontmatter round trip and close guard"
```

---

### Task 11: Final verification and README

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: everything
- Produces: verified app + docs

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests PASS. Record the count.

- [ ] **Step 2: Run the spec's manual smoke checklist**

Run: `npm start` and verify each item from the spec:
- File open/save/save-as round trip
- Unsaved-changes prompts (New / Open / window close), including edits made only in the frontmatter panel
- Edit/Preview toggle preserving cursor and scroll
- Math, Mermaid, and footnote rendering in preview
- Malformed mermaid block → inline error box only
- Frontmatter round trip (open file with a YAML block → edit in panel → save → block written back; nested YAML preserved verbatim)
- Every toolbar button + every keyboard shortcut (`Ctrl+B/I/K/E/N/O/S`, `Ctrl+Shift+S`)

Fix anything that fails before proceeding (use superpowers:systematic-debugging).

- [ ] **Step 3: Write README.md**

```markdown
# MarkPad

A small Windows desktop markdown editor: one file at a time, a GFM formatting
toolbar, a collapsible frontmatter panel, and an Edit/Preview toggle.

## Run

    npm install
    npm start

## Test

    npm test

## Features

- Toolbar: H1–H3, bold, italic, strikethrough, inline code, code block, link,
  image, blockquote, bullet/numbered/task lists, table, horizontal rule
- `Ctrl+E` toggles between the markdown source and a rendered preview
- Frontmatter: YAML at the top of a file appears in a collapsible key-value
  panel above the editor; unknown YAML lines are preserved verbatim
- Preview renders GFM plus footnotes, KaTeX math (`$x^2$`), and Mermaid
  diagrams (```` ```mermaid ```` blocks)
- Unsaved-changes guard on New / Open / close
- Shortcuts: `Ctrl+B` bold, `Ctrl+I` italic, `Ctrl+K` link, `Ctrl+N` new,
  `Ctrl+O` open, `Ctrl+S` save, `Ctrl+Shift+S` save as

Design spec: `docs/superpowers/specs/2026-07-07-markdown-editor-design.md`
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README with usage and feature summary"
```
