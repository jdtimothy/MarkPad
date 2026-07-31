# Frontmatter Templates — Design Spec

**Date:** 2026-07-31
**Status:** Approved by user

## Purpose

Let the user pick a named template that fills in a document's frontmatter keys,
so starting a post does not mean retyping the same field names or remembering a
project's schema from memory. Templates are defined by the user, so MarkPad
learns no project's conventions of its own.

A second, independent change warns when a frontmatter row has a key but no
value. That state serializes to `title:`, which is YAML null, and every
schema-validating generator rejects it where it would accept a missing key or
an empty string. It is the failure that motivated this work: a post committed
with an empty `title:` broke an Astro build on Netlify.

The two features do not depend on each other. The warning protects documents
that use no template at all; templates are useful with the warning removed.

## Decisions Made

These were chosen over the alternatives considered, and should not be
re-litigated without new information.

- **Templates live in MarkPad, not in the repository.** Reading them from a
  repo (the user's blog already has a `_template.md`) would do nothing for
  local files or a future Obsidian vault, neither of which has a repo
  identity. Local storage serves every document MarkPad can open.
- **No remembered default template per repo.** The first design applied the
  last-used template automatically. It needed two storage scopes — per-repo for
  GitHub documents, global for local ones — and could apply a template chosen
  days earlier to a document the user did not expect. An always-visible
  selector needs no remembered state and shows what will happen.
- **A template is keys and default values only.** No types, no required flags,
  no validation. MarkPad cannot know a project's schema, and a template that
  claimed to would be wrong the first time a schema changed.
- **Applying a template never overwrites.** It adds keys that are missing and
  leaves every existing row untouched, so the selector is safe to press at any
  time and doubles as a way to bring an older document up to a schema.
- **The empty-value warning never blocks.** It is visual only. Null is
  legitimate frontmatter in some projects, and MarkPad has no standing to
  refuse a save.

## Architecture

A new module, `src/renderer/templates.js`, holds template storage and the two
pure operations. It follows the precedent set by `repo-config.js`: MarkPad's
own settings live in local storage and never in the user's project.

`frontmatter.js` is unchanged. It stays pure and storage-free; the template
module consumes the row shape it already produces.

```
listTemplates(store)                       → [{ name, rows }]
saveTemplate(store, name, rows)            → void
deleteTemplate(store, name)                → void
applyTemplate(existingRows, templateRows)  → rows          (pure)
expandDefaults(templateRows, today)        → rows          (pure)
```

The storage functions take an injected `store` (anything with `getItem` and
`setItem`), matching the convention the GitHub modules use for `fetch`, so
tests never touch a real `localStorage`.

### Template shape

A template is an ordered array of `{ key, value }` pairs — exactly what
`parseFrontmatter` returns, minus `{ raw }` rows. Raw rows are dropped when
saving: they exist to preserve YAML that MarkPad could not parse, which is
meaningful for a specific document and meaningless as a default.

Stored as one JSON object under `markpad.templates`:

```json
{
  "version": 1,
  "seeded": true,
  "templates": {
    "Basic": [
      { "key": "title", "value": "" },
      { "key": "date",  "value": "{today}" },
      { "key": "tags",  "value": "[]" }
    ]
  }
}
```

### Seeding

On first run, storage is seeded with one template named **Basic**, holding
exactly what `defaultFrontmatter()` produces today — `title`, `date`, `tags`.
This preserves current behaviour for anyone who never opens the feature, and
means the list is never empty. Basic is an ordinary template and can be
renamed or deleted.

The `seeded` flag above is why deletion sticks. Without it, seeding would key
off an empty list and Basic would reappear the next time the app started,
making it impossible to remove. The `version` field exists so a future change
to the stored shape can migrate rather than discard.

## Flows

### Applying a template

The frontmatter panel header gains a **Template** control listing every saved
template, alongside a **Save as template…** button.

The control is a `<select>` whose options are, in order: a disabled
placeholder reading `Choose…`, then one option per saved template, then a
final `Manage…` entry. A `<select>` rather than a custom menu because the
panel already uses native selects and inherits their keyboard behaviour for
free. Choosing `Manage…` opens the management list and resets the control
without applying anything.

Choosing a name resolves the template's dynamic defaults, merges it into the
current rows, re-renders, and marks the document dirty through the existing
`onChange` path. Saving and committing are untouched.

On a document with no frontmatter, applying a template creates the block. On a
document that already has frontmatter, it merges.

The control returns to its neutral "Choose…" state after applying. MarkPad
does not record which template a document came from, and cannot: the moment a
field is edited the association is a guess. A control that kept displaying
"Blog post" would be claiming knowledge the app does not have.

The control never removes anything. Choosing nothing does nothing; removing
frontmatter remains the existing **Remove frontmatter** button. There is
deliberately no "No template" entry, because it would imply a subtractive
action the control does not perform.

### Merge semantics

`applyTemplate(existing, template)` returns:

- every existing row, in its original order, with its value unchanged —
  including `{ raw }` rows
- followed by each template row whose key is not already present, in template
  order, carrying the template's default

Key comparison is case-sensitive, so `pubDate` and `pubdate` are distinct
keys. This matches YAML, and treating them as the same would silently skip a
field the user's schema requires.

Applying the same template twice is therefore a no-op — every key already
exists — which is what makes the control safe to press without thinking.

### Dynamic defaults

One token is recognised: `{today}`, replaced with the current date as
`YYYY-MM-DD` when a template is applied. Every occurrence within a value is
replaced, not just a value consisting solely of the token, so
`archive/{today}.md` resolves as expected. Every other value is literal. This
is the only dynamic value the existing code needed, and more tokens can be
added later without changing the shape.

The date comes from the caller rather than being read inside `expandDefaults`,
keeping the function pure and its tests free of the clock.

When saving a template, a value that exactly equals today's date is stored as
`{today}` rather than the literal date. Without this, saving a template from a
real post would bake in a fixed date that is wrong for every future document.
This is the one place the feature infers intent, and it is confined to an exact
match against today.

### Saving a template

**Save as template…** captures the panel's current rows, drops `{ raw }` rows,
applies the `{today}` substitution above, and prompts for a name. The prompt is
the app's own dialog, not `window.prompt`, which Electron does not implement.

An existing name asks for confirmation before overwriting. An empty name is
rejected. Names are compared with surrounding whitespace trimmed.

Authoring a template is therefore the same skill as editing a document: fill in
the fields once, then save them. There is no second key/value editor to learn
or to keep consistent with the first.

### Managing templates

The template control offers a **Manage…** entry opening a small list, where a
template can be renamed or deleted. Deleting asks for confirmation. Deleting
the last template leaves an empty list, and the control shows an empty state
rather than disappearing.

### Empty-value warning

A row whose key is non-empty and whose value is empty is marked with a warning
indicator and a tooltip explaining that an empty value becomes null in YAML and
most site generators reject it.

The marker updates as the user types, toggled in place rather than by
re-rendering the row — the same technique the frontmatter image picker uses, so
the caret is never disturbed mid-word.

A row with an empty key is not marked. That is an unfinished row the user is
still typing, not a mistake to report.

## Error handling

| Condition | Behaviour |
|---|---|
| `localStorage` unavailable or throws | Treated as an empty template list; the feature degrades to unavailable rather than breaking the panel |
| Stored JSON corrupt | Same — parsed defensively, replaced on next save |
| Duplicate template name | Confirm before overwriting |
| Empty or whitespace-only name | Rejected, dialog stays open |
| Template with no rows | Rejected; there is nothing to apply |
| Applying a template that no longer exists | Ignored; the list is re-read on open |

No failure in this feature may prevent editing, saving or committing a
document.

## Testing

The pure functions carry the load:

- `applyTemplate` — adds only missing keys; preserves existing values, order
  and `{ raw }` rows; case-sensitive key matching; idempotent when applied
  twice; empty existing rows; empty template
- `expandDefaults` — `{today}` substituted, literals untouched, the token
  appearing in more than one row, and a token embedded in a longer value
  (`archive/{today}.md`) rather than standing alone
- storage round trip against an injected fake store — list, save, delete,
  overwrite, corrupt JSON, throwing store
- seeding — Basic present on first run, not re-added after deletion

A jsdom test covers the panel, following `tests/fmpanel-image.test.js`:
selector lists templates and applies one, save-as-template captures the right
rows and drops raw rows, the empty-value marker appears and clears as the value
is typed without the row being rebuilt.

## Out of scope

Deliberately excluded; each is a plausible next step and none is needed for
this to be useful.

- Sharing templates through the repository
- A remembered default template per repo
- Field types, required flags, or any validation
- Reading an existing `_template.md` to build a template
- Reordering rows within a template
- Tokens beyond `{today}`
