# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm start` — bundles the renderer (esbuild) then launches Electron. The `start` script always rebuilds first, so there is no separate watch step.
- `npm run build` — bundles `src/renderer/index.js` into `dist/renderer.js` (IIFE) plus hashed font/asset files. Electron loads `src/renderer/index.html`, which references the built bundle.
- `npm test` — runs the Vitest suite once (`vitest run`).
- Run a single test file: `npx vitest run tests/formatting.test.js`
- Run tests by name: `npx vitest run -t "preserves checked task list"`

Tests live in `tests/` and import directly from `src/renderer/`. There is no global Vitest config; files that need a DOM opt in per-file with a `// @vitest-environment jsdom` comment at the top.

## Architecture

MarkPad is an Electron markdown editor. Three process layers:

- **Main** (`src/main/main.js`) — window creation (frameless + acrylic), all filesystem access, and native dialogs (open/save/save-as/unsaved-changes/image-picker) exposed as `ipcMain` handlers. Owns no document state.
- **Preload** (`src/preload.js`) — the only bridge. Exposes a minimal `window.markpad` API over `contextBridge`; `contextIsolation` is on and `nodeIntegration` is off. Any new main↔renderer call must be added here.
- **Renderer** (`src/renderer/`) — all editor logic and UI.

### The two-mode editing model (the core concept)

The editor has two mutually exclusive modes, toggled by `Ctrl+E` and managed in `ui.js` (`setMode`):

- **`edit`** — CodeMirror 6 editing the raw markdown source (`editor.js`).
- **`preview`** — a `contenteditable` rendered view. This is a *live editable* preview, not read-only. Toolbar actions in this mode manipulate the DOM via `document.execCommand` and hand-built DOM surgery (see the large block of `insert*`/`exit*`/`closest*` helpers in `ui.js`).

The source of truth is always the markdown string in CodeMirror. In preview mode, edits are converted back to markdown by `htmlToMarkdown` (`rendered-editor.js`) and written into CodeMirror via `syncFromRendered()`. Switching modes, saving, and the dirty check all funnel through this sync so the two representations never diverge. **When adding a formatting action, implement it for both modes** — `codeActions` (CodeMirror) and `renderedActions` (contenteditable) in `ui.js`, plus its detection in `codeToolbarState`/`renderedToolbarState` for the toolbar's active-state highlighting.

### Markdown ↔ HTML round-trip

- Forward (md → HTML): `markdown.js` (`renderMarkdown`) runs markdown-it with footnote, task-list, and texmath (KaTeX) plugins, then **DOMPurify sanitizes** the output. `preview.js` (`renderPreview`) additionally renders Mermaid code fences to sanitized SVG. All rendered HTML passes through DOMPurify — preserve this when touching the render path.
- Reverse (HTML → md): `rendered-editor.js` (`htmlToMarkdown`) is a hand-written serializer walking the DOM. It is the trickiest code in the repo (lists, nested blocks, tables, code fences, escaping) and is the most heavily tested.

### Document composition and dirty tracking

`index.js` is the orchestrator. A saved document = frontmatter block + body: `joinDoc(fmPanel.getFrontmatter(), getDoc(view))` (see `fullDoc()`). Dirtiness is `fullDoc() !== savedDoc` — a string comparison against the last-saved snapshot, not an event flag. The close guard is cooperative: main sends `close-requested`, the renderer runs `guardDirty()`, then replies with `confirmClose()`.

### Frontmatter

`frontmatter.js` is pure and **deliberately uses no YAML library** (see the design spec). It handles only flat `key: value` pairs; any line it can't parse is preserved verbatim as a `{ raw }` row so unknown/nested YAML is never destroyed. `fmpanel.js` renders the collapsible key-value editor. `rows === null` means "document has no frontmatter" (distinct from an empty frontmatter block).

### Design docs

`docs/superpowers/specs/2026-07-07-markdown-editor-design.md` (design spec) and `docs/superpowers/plans/2026-07-07-markdown-editor.md` (implementation plan) capture the intended behavior and the rationale for choices like the no-YAML-library decision.
