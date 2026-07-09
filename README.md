# MarkPad

A modern Windows desktop markdown editor with an active toolbar and live preview editing

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
  panel above the editor; unknown YAML lines are preserved verbatim. Saving
  normalizes key-value spacing and the blank line after the frontmatter
  block, while unknown/nested lines are still preserved verbatim.
- Preview renders GFM plus footnotes, KaTeX math (`$x^2$`), and Mermaid
  diagrams (```` ```mermaid ```` blocks)
- Unsaved-changes guard on New / Open / close
- Shortcuts: `Ctrl+B` bold, `Ctrl+I` italic, `Ctrl+K` link, `Ctrl+N` new,
  `Ctrl+O` open, `Ctrl+S` save, `Ctrl+Shift+S` save as

Design spec: `docs/superpowers/specs/2026-07-07-markdown-editor-design.md`
