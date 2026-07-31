# GitHub Integration — Design Spec

**Date:** 2026-07-31
**Status:** Approved by user

## Purpose

Let MarkPad open markdown files directly from a GitHub repository, edit them
with the existing editor, and commit changes back — plus create new posts,
upload images, rename and delete files, and open a pull request. The target
use case is editing a personal website's blog posts without leaving the editor
or touching a terminal.

Local file editing is unchanged. GitHub-backed documents sit alongside local
ones; neither mode interferes with the other.

## Decisions Made

| Question | Decision |
|---|---|
| Repo access | GitHub REST API only — no local clone. A clone-backed mode may be added later behind the same interface. |
| Authentication | OAuth **device flow** against a GitHub OAuth App. Token encrypted at rest with Electron `safeStorage`. |
| Commit model | User picks a target branch up front; every save commits directly to it. PR creation is a separate explicit action. |
| Write mechanism | Git Data API (blob → tree → commit → update-ref) behind a single multi-file `commit()` primitive. |
| Save UX | `Ctrl+S` opens a commit bar with an editable pre-filled message, then commits. |
| File browsing | Collapsible left sidebar showing a folder tree filtered to markdown files. |
| Repo scope | Switchable list of the user's repos, fetched after sign-in; last selection remembered. |
| Site generator | No conventions baked in. Content and image directories are per-repo settings, guessed on first connect. |
| Operations in scope | Open, save/commit, new post, image upload, rename, delete, create PR. |
| Out of scope | Merge/conflict resolution, git history browsing, diff view, issues, review comments, multi-file tabs. |

## Prerequisite (manual, one time)

The user registers a GitHub **OAuth App** (Settings → Developer settings →
OAuth Apps → New), enables "Device flow" in its settings, and copies the
**Client ID** into MarkPad's configuration. The client ID is a public value and
is safe to commit to this repository. Device flow uses no client secret.

Known limitation: OAuth Apps offer only the coarse `repo` scope — read/write
access to all of the user's repositories, not just the blog repo. A GitHub App
would allow per-repo installation and would require the same client-side code;
switching later is a configuration change, not a redesign.

## Architecture

All GitHub HTTP happens in the **main** process. The token never reaches the
renderer, and the existing `will-navigate` / `setWindowOpenHandler` guards stay
intact because the renderer never contacts a remote origin. Remote assets
(preview images) are fetched by main and handed to the renderer as data URLs.

```
src/main/github/
  auth.js     device-flow state machine; token vault (safeStorage → userData/credentials.json)
  client.js   fetch wrapper: auth header, JSON handling, error mapping
  repo.js     listRepos, listBranches, listTree, readFile, readAsset,
              commit(), createBranch, findPullRequest, createPullRequest

src/preload.js              adds a `window.markpad.github.*` namespace

src/renderer/
  doc-source.js   NEW — the local-vs-repo document source abstraction
  github-panel.js NEW — sidebar: connect, repo picker, branch picker, file tree
  index.js        orchestrator; load/save delegate to the active source
  preview.js      resolves image sources through the pending/committed asset map
```

### The document source seam

`index.js` currently assumes a document is a local path. That assumption moves
into `doc-source.js`, which exposes one small interface with two
implementations:

```js
{ kind: 'local', path }                           // existing behavior, unchanged
{ kind: 'repo', repo, branch, path, baseSha }     // new
```

The source answers `load()`, `save(content, options)`, and `displayName()`.
`index.js` keeps its role as orchestrator and gains no GitHub-specific logic.

A future clone-backed mode is a third `kind: 'clone'` implementing the same
three methods — this is the seam that makes "API now, clone later" cheap.

Dirty tracking needs no changes. It is a string comparison of `fullDoc()`
against `savedDoc`, which behaves identically whether the last save wrote to
disk or produced a commit.

### Why the Git Data API

The Contents API writes one file per call, which would make a rename two
commits and would prevent a post and its new image from landing together. The
Git Data API costs roughly four requests per save but supports any number of
files in one atomic commit. Every write operation therefore reduces to a single
primitive:

```js
commit({ repo, branch, message, files: [
  { path, content },              // create or update
  { path, delete: true },         // remove (emitted as sha: null in the tree)
] })
```

Save, new post, image upload, rename and delete are all calls to this one
function. Reads use the simpler `GET /repos/{o}/{r}/contents/{path}` and
`GET /repos/{o}/{r}/git/trees/{sha}?recursive=1` endpoints.

## Flows

### Sign in

The sidebar shows "Connect to GitHub". Main requests a device code, and a modal
displays the user code with a copy button and an "Open GitHub" button
(`shell.openExternal` to the verification URI). Main polls the token endpoint at
the interval GitHub specifies, handling `authorization_pending`, `slow_down`
(increase interval), `expired_token` (restart), and `access_denied` (abort).

On success the token is encrypted with `safeStorage.encryptString` and written
to `userData/credentials.json`. The renderer learns only the account login.
"Sign out" deletes the vault file and clears in-memory state.

### Repo and branch selection

The repo picker lists `GET /user/repos?sort=updated` with a filter box; the
choice is remembered across sessions. The branch picker lists branches and
offers "New branch…", which creates a ref from the current head.

**The selected branch is the commit target for every write.** Changing it
re-reads the file tree.

### Browsing and opening

`GET /git/trees/{branchSha}?recursive=1` returns the entire file list in one
request. MarkPad filters to `.md`/`.markdown`, builds a nested tree in the
renderer, and renders a collapsible sidebar. `Ctrl+B` toggles it.

If the trees response sets `truncated` (repositories beyond ~100k entries),
the sidebar shows a notice that the listing is incomplete rather than silently
displaying a partial tree.

Opening a file runs the existing sequence — `guardDirty()`, CRLF
normalization, `splitFrontmatter`, populate the frontmatter panel and editor —
and records the file's blob SHA as `baseSha`. The tree is cached per
(repo, branch) and refreshed after any commit or on manual refresh.

### Saving

`Ctrl+S` on a repo-backed document opens a commit bar pre-filled with
`Update <path>`. The message is editable; Enter commits, Escape cancels the
save entirely. The commit then runs:

1. Read the branch head ref and its commit/tree SHAs.
2. Assemble the file list: the document plus any pending image attachments.
3. Create blobs, create a tree with `base_tree` set to the head tree, create a
   commit with the head as parent.
4. `PATCH` the ref with `force: false`.

On success MarkPad updates `baseSha`, marks the document saved, clears pending
attachments, and refreshes the tree if any paths were added or removed.

### Conflicts

Two independent guards:

- **Stale file** — before committing, the file's current blob SHA at head is
  compared against the `baseSha` recorded at open. A difference means someone
  else changed this file.
- **Moved branch** — `PATCH ref` with `force: false` is rejected by GitHub if
  the update is not a fast-forward.

Either triggers one dialog with three choices:

| Choice | Behavior |
|---|---|
| Overwrite | Re-parent the commit onto the new head and commit anyway |
| Reload from GitHub | Discard local edits and re-read the file (confirms first) |
| Open on GitHub | Open the file in the browser to inspect; the save is cancelled |

No automatic merge is attempted. Three-way merging needs the full object graph
and belongs to a future clone-backed mode; guessing here would risk losing
work silently.

### New post

The sidebar's `+` opens a path dialog pre-filled with
`{contentDir}/untitled.md`, cursor positioned on the slug. The result is an
unsaved repo-backed document — nothing reaches GitHub until the first
`Ctrl+S`, at which point it is an ordinary commit for a path that did not
previously exist.

### Images

Choosing an image in repo mode **stages** it rather than uploading immediately.
Main reads the bytes; the renderer records a pending attachment at
`{imageDir}/{filename}` (appending a numeric suffix on collision) and inserts a
markdown link built according to the repo's `imageLinkStyle` (post-relative or
site-root-absolute).

Pending attachments are included in the next commit, so a post and its images
land together. Discarding the document without committing drops them, which the
dirty-state guard warns about.

Preview resolves image sources through a map:

- **Pending** images render from an in-memory data URL.
- **Committed** images are fetched by the main process and returned as data
  URLs, cached by (repo, branch, path). This keeps the renderer free of remote
  origins and works for private repositories, where raw URLs require the token.

### Rename and delete

Right-clicking a file in the tree offers Rename and Delete. Rename prompts for
a new path and produces **one** commit containing `{ new path, content }` and
`{ old path, delete: true }`. Delete confirms, then commits a single deletion.
If the affected file is the open document, its source path updates in place.

### Create pull request

Available when the selected branch is not the repository's default branch.
MarkPad first queries `GET /pulls?head={owner}:{branch}&state=open`; if a PR
already exists it offers "View PR" rather than attempting a duplicate. Otherwise
a dialog collects title (defaulting to the branch name), body, and base branch
(defaulting to the repo default), then `POST /pulls` and opens the resulting URL.

## Per-repo configuration

Stored in MarkPad's `userData`, never written into the user's repository:

| Key | Meaning | Default |
|---|---|---|
| `contentDir` | Where new posts are created | Guessed by probing for `content/`, `src/content/`, `posts/`, `_posts/` |
| `imageDir` | Where staged images are committed | Guessed by probing for `static/`, `public/`, `assets/` |
| `imageLinkStyle` | `relative` or `site-absolute` | `relative` |
| `lastBranch` | Branch restored on reconnect | Repository default branch |

Guesses are editable in a small settings row on the sidebar. No generator's
conventions are hard-coded.

## Error handling

All failures funnel to the existing `ui.showError`.

| Condition | Response |
|---|---|
| 401 | Token invalid or revoked — clear the vault and prompt to reconnect |
| 403 with rate-limit headers | "GitHub rate limit reached, resets at <time>" |
| 404 on write | Branch or path no longer exists — refresh the tree |
| Non-fast-forward ref update | Conflict dialog (above) |
| 422 | Surface GitHub's own message (typically an invalid ref or existing PR) |
| Network failure | "Can't reach GitHub — your edits are still here" |

A failed commit never modifies the editor buffer or `savedDoc`, so no edit is
lost by any error path.

## Testing

`client.js` accepts `fetch` as a parameter, so every module is unit-testable
with no network access. New Vitest files in `tests/`:

| File | Covers |
|---|---|
| `github-tree.test.js` | Flat path list → nested tree, markdown filtering, sort order, truncation flag |
| `github-commit.test.js` | Blob/tree/commit/ref request sequence against a fake fetch; `sha: null` deletes; multi-file atomicity; `base_tree` wiring |
| `github-auth.test.js` | Device-flow state machine: pending → `slow_down` backoff → success; expired and denied paths |
| `github-paths.test.js` | Slug and filename generation, image collision suffixing, relative vs site-absolute link construction |
| `doc-source.test.js` | Local vs repo dispatch; conflict decision given `(baseSha, headSha)` |

DOM-dependent sidebar tests opt into jsdom per-file, matching the existing
convention.

## Implementation phases

Each phase is independently shippable.

1. **Connect and browse** — device-flow auth, token vault, repo and branch
   pickers, sidebar file tree, open a file for editing.
2. **Commit** — the `commit()` primitive, the `Ctrl+S` commit bar, conflict
   detection and dialog. *The feature becomes genuinely useful here.*
3. **File management** — new post, rename, delete.
4. **Publishing** — image staging and upload, pull request creation.
