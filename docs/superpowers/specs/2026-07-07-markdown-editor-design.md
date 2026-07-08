# Markdown Editor ("MarkPad") — Design Spec

**Date:** 2026-07-07
**Status:** Approved by user

## Purpose

A small Windows desktop application for writing markdown. One file at a time,
a formatting toolbar covering the full GitHub Flavored Markdown (GFM) set, and
a toggle between the raw markdown code view and a rendered live preview.

## Decisions Made

| Question | Decision |
|---|---|
| Platform | Desktop app (Electron) |
| File handling | Single file: New / Open / Save / Save As |
| View model | Toggle between code view and rendered preview (`Ctrl+E`) |
| Toolbar scope | Full standard GFM set |
| Extensions | GFM-only toolbar; preview additionally renders footnotes, math (KaTeX), and Mermaid diagrams |
| Frontmatter | Collapsible key-value panel between toolbar and editor owns the YAML block |
| Out of scope | Tabs, folder sidebar, slideshows, collages/image grids, callouts toolbar buttons |

## Architecture

Electron app with the standard secure two-layer split:

- **Main process (Node.js):** window lifecycle, native open/save dialogs,
  reading and writing `.md` files, unsaved-changes confirmation on close.
- **Renderer (UI):** single-page interface in plain HTML/CSS/JavaScript — no
  UI framework. Communicates with main via a preload IPC bridge
  (`contextIsolation: true`, `nodeIntegration: false`).

### Libraries

| Library | Role |
|---|---|
| CodeMirror 6 | Editor pane: markdown syntax highlighting, undo history, selection APIs for toolbar actions |
| markdown-it + GFM plugins | Preview rendering (tables, task lists, strikethrough, autolinks, footnotes) |
| KaTeX | `$inline$` and `$$block$$` math in preview |
| Mermaid | ` ```mermaid ` fenced blocks rendered as diagrams in preview |
| DOMPurify | Sanitize all rendered preview HTML |
| Vitest | Unit tests for formatting logic |

## UI Layout

```
┌──────────────────────────────────────────────────┐
│ New  Open  Save │ H1 H2 H3 │ B I S `code` │ 🔗 🖼 │
│ ❝ • 1. ☑ │ ⊞ table ─ hr │       [ Edit | Preview ]│
├──────────────────────────────────────────────────┤
│ ▸ Frontmatter (3)                         Remove  │
├──────────────────────────────────────────────────┤
│                                                  │
│     Editor (code view)  ⇄  Rendered preview      │
│                                                  │
├──────────────────────────────────────────────────┤
│ filename.md ●unsaved      words: 342   Ln 12     │
└──────────────────────────────────────────────────┘
```

- **Toolbar:** file actions (New, Open, Save), then formatting buttons:
  headings H1–H3, bold, italic, strikethrough, inline code, code block, link,
  image, blockquote, bullet list, numbered list, task list, table (inserts a
  2×3 skeleton), horizontal rule.
- **Edit/Preview toggle** at top right; keyboard shortcut `Ctrl+E`. One
  content area switches between the two modes.
- **Frontmatter panel:** collapsible strip between the toolbar and the
  content area, visible in both Edit and Preview modes (see Behavior).
- **Status bar:** file name, unsaved-changes dot, word count, cursor line.

## Behavior

### Toolbar actions
- Inline styles (bold, italic, strikethrough, inline code) wrap the current
  selection, or insert the markers with the cursor placed between them when
  nothing is selected. Clicking the button again on already-styled text
  unwraps it (toggle both ways).
- Block styles (headings, blockquote, lists) apply to the current line(s) and
  toggle off if already applied. Heading buttons replace any existing heading
  level.
- Link/image prompt for the URL (selection becomes the link text); table and
  horizontal rule insert templates at the cursor.
- All actions go through CodeMirror transactions so undo/redo works normally.

### Keyboard shortcuts
`Ctrl+B` bold, `Ctrl+I` italic, `Ctrl+K` link, `Ctrl+E` toggle preview,
`Ctrl+N` new, `Ctrl+O` open, `Ctrl+S` save, `Ctrl+Shift+S` save as.

### Preview
- Renders GFM plus footnotes, KaTeX math, and Mermaid diagrams.
- Read-only. Switching back to Edit restores the previous cursor and scroll
  position.
- A malformed Mermaid or math block renders an inline error box in its place;
  the rest of the document still renders.
- All output passes through DOMPurify before insertion into the DOM.

### Frontmatter panel

- When a document starts with a `---` YAML block, the app strips it from the
  editor: editor, preview, and word count only ever see the body. The panel
  owns the block and shows it as key + value field rows, each with a remove
  button, plus "+ Add property" and "Remove frontmatter" actions. On save the
  panel is serialized back to YAML and prepended to the body.
- Values are plain text scalars, so list syntax like `tags: [notes, ideas]`
  is typed into the value field. Any line that is not a simple `key: value`
  pair (nested YAML, comments) appears as a read-only row and is written back
  verbatim — the app never destroys frontmatter it does not understand. No
  YAML library; a flat line-based parser is sufficient.
- When a file has no frontmatter the panel collapses to a slim
  "+ Add frontmatter" bar; clicking it inserts a starter template (`title`,
  `date` pre-filled with today, `tags: []`) and expands the panel.
- The panel opens collapsed for existing files and expanded when just
  created. Header shows `▸ Frontmatter (n)` with a chevron toggle. Panel
  edits count toward the unsaved-changes indicator.

### File handling
- New / Open / Save / Save As via native dialogs, filtered to
  `.md` / `.markdown` / `.txt`.
- Unsaved changes shown as `●` in the title bar and status bar. Closing the
  window, opening a file, or creating a new file with unsaved changes prompts
  Save / Don't Save / Cancel.
- Files read and written as UTF-8.

## Error Handling

- File read/write failures (locked file, permissions, OneDrive sync
  conflicts) show a dismissible error banner in the UI; editor content is
  never discarded on a failed save.
- Renderer errors in preview extensions (Mermaid/KaTeX) are contained to the
  offending block (see Preview above).

## Testing

- **Unit tests (Vitest):** the formatting engine — wrap/unwrap/toggle logic
  for every toolbar action, including edge cases (empty selection, partial
  overlap with existing markers, multi-line selections for block styles) —
  and the frontmatter module (split/join round trips, unparseable-line
  preservation).
- **Manual smoke checklist:** file open/save/save-as round trip, unsaved
  changes prompts, Edit/Preview toggle preserving state, math/Mermaid/footnote
  rendering, frontmatter round trip (open a file with frontmatter → edit in
  panel → save → block written back; nested YAML preserved).

## Module Boundaries

| Module | Responsibility |
|---|---|
| `main/` | Electron main: window, dialogs, file I/O, close guard |
| `preload` | IPC bridge exposing `openFile`, `saveFile`, `saveFileAs`, dirty-state notifications |
| `renderer/editor` | CodeMirror setup and state |
| `renderer/formatting` | Pure functions implementing every toolbar action against an editor state (unit-tested) |
| `renderer/frontmatter` | Pure functions: split/join doc, parse/serialize flat key-value YAML (unit-tested) |
| `renderer/fmpanel` | Frontmatter panel DOM component: rows, collapse, add/remove |
| `renderer/preview` | markdown-it pipeline + KaTeX + Mermaid + DOMPurify |
| `renderer/ui` | Toolbar wiring, view toggle, status bar, error banner |
