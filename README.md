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
- A property with a key but no value is flagged, because an empty value
  becomes YAML `null` and most site generators reject it
- Preview renders GFM plus footnotes, KaTeX math (`$x^2$`), and Mermaid
  diagrams (```` ```mermaid ```` blocks)
- Unsaved-changes guard on New / Open / close
- Shortcuts: `Ctrl+B` bold, `Ctrl+I` italic, `Ctrl+K` link, `Ctrl+N` new,
  `Ctrl+O` open, `Ctrl+S` save, `Ctrl+Shift+S` save as,
  `Ctrl+Shift+B` GitHub sidebar

## Frontmatter templates

The frontmatter panel has a **Template** dropdown. Choosing a template fills in
its keys, so starting a post does not mean retyping the same field names or
remembering a project's schema.

Applying a template **only ever adds keys that are missing**. Values you have
already typed are never touched and rows never move, so the dropdown is safe to
use on a half-written document — and it doubles as a way to bring an older post
up to a schema you have since changed. Applying the same template twice does
nothing the second time. The dropdown returns to "Choose…" afterwards: MarkPad
does not track which template a document came from, because once you edit a
field that association is a guess.

**Save as template…** captures the panel's current fields under a name you
give, which is how you author a template in the first place — fill in the
fields once, then save them. A value that is exactly today's date is stored as
`{today}` and resolves to the current date each time the template is applied.
**Manage…** renames and deletes.

Templates are stored by MarkPad rather than in your project, so they work for
local files as well as repository documents, and nothing is written into your
repository. MarkPad ships one template, `Basic`, which you can rename or delete
like any other.

## GitHub integration

MarkPad can edit files straight from a GitHub repository — no local clone.
`Ctrl+Shift+B` opens the sidebar, where you connect an account, pick a
repository and branch, and browse the markdown files in it. Opening a file
loads it into the editor; `Ctrl+S` then commits it back to the selected
branch with a message you supply. Images inserted from the toolbar are staged
and land in the *same* commit as the post. Renaming a file is likewise one
commit containing both the addition and the deletion.

### Images

Choosing an image uploads nothing straight away: it is staged in memory,
linked into the document, and committed alongside the post the next time you
save. Frontmatter rows get an image picker too — the 🖼 button appears on any
row whose key reads like an image field (`hero`, `cover`, `image`, `thumbnail`,
`banner`, `photo`, `picture`, `logo`, `avatar`, and decorated forms like
`featured_image` or `heroImage`) or whose value already points at an image
file. Both the body and frontmatter pickers use the repository's image folder,
avoid overwriting an existing file by suffixing the name, and write the link in
whichever style the repository is configured for.

New posts and renames get a `.md` extension when you leave one off, since a
file without it is invisible to both the sidebar and most generators.

Frontmatter images are not shown in the preview, which renders only the
document body. A frontmatter value holding a list of images is left alone —
the frontmatter panel handles flat `key: value` pairs and preserves anything
else verbatim.

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
