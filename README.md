# MarkPad

A small Windows desktop markdown editor: one file at a time, a GFM formatting
toolbar, a collapsible frontmatter panel, and an Edit/Render view.

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
  `Ctrl+O` open, `Ctrl+S` save, `Ctrl+Shift+S` save as,
  `Ctrl+Shift+B` GitHub sidebar

## GitHub integration

MarkPad can edit files straight from a GitHub repository — no local clone.
`Ctrl+Shift+B` opens the sidebar, where you connect an account, pick a
repository and branch, and browse the markdown files in it. Opening a file
loads it into the editor; `Ctrl+S` then commits it back to the selected
branch with a message you supply. Images inserted from the toolbar are staged
and land in the *same* commit as the post. Renaming a file is likewise one
commit containing both the addition and the deletion.

### Setting up the OAuth App

The integration authenticates with GitHub's OAuth **device flow**, which needs
a registered OAuth App but no client secret.

1. Go to <https://github.com/settings/developers> → **OAuth Apps** → **New OAuth App**.
2. Homepage URL and Authorization callback URL can be any valid URL — device
   flow does not use either.
3. **Check "Enable Device Flow."** This is the setting people miss; without it
   connecting fails at runtime with a `device_flow_disabled` error.
4. Copy the generated **Client ID** into `CLIENT_ID` at the top of
   `src/main/github/index.js`.

The client ID is a public value and safe to commit — no secret is involved.

### Scope caveat

OAuth Apps only offer the coarse `repo` scope, so authorizing grants MarkPad
read/write access to all repositories you can reach, not just the one you
pick in the sidebar. A GitHub App would allow per-repository installation
with the same client-side code, if that ever matters to you.

### Per-repository settings

The sidebar's "Repository settings" section holds the folder new posts go in,
the folder images upload to, and whether image links are written relative to
the post or absolute from the site root. MarkPad guesses these from the
repository's layout on first load and stores any changes locally — nothing is
written into your repository.

Design spec: `docs/superpowers/specs/2026-07-07-markdown-editor-design.md`
GitHub integration spec: `docs/superpowers/specs/2026-07-31-github-integration-design.md`
