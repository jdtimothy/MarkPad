# Changelog

All notable changes to MarkPad will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Edit, commit and publish markdown files directly from a GitHub repository.
  Connect via OAuth device flow, browse a repository's markdown files in a
  `Ctrl+Shift+B` sidebar, and commit changes back to a chosen branch on save.
- Every write — save, new post, image upload, rename, delete — is a single
  atomic commit built on the Git Data API, so a post and its images land
  together and a rename is one commit rather than two.
- Conflict detection when a file or branch changed on GitHub since it was
  opened, with overwrite / reload / open-on-GitHub / cancel resolution.
- Branch creation and pull request creation from the sidebar.
- Per-repository settings for the content folder, image folder, and image
  link style, stored locally rather than in the repository.
- Image picker on frontmatter rows, so a hero/cover image is staged, named
  and linked exactly like a body image and lands in the same commit.

### Fixed
- The toolbar's image button opened the URL prompt instead of the native file
  picker for local (non-repository) documents.
- Images were embedded into the document as base64 data URLs instead of links.
  The rendered pane swaps in resolved image bytes for display, and because
  that pane is the editable source of truth, the data URL was serialized back
  into the markdown on save.
- New posts and renames without a markdown extension produced a file that
  neither the sidebar tree nor most static-site generators would recognize;
  `.md` is now appended when missing.
- Image folder detection preferred `public` over `src/assets` on Astro-shaped
  repositories, where content images belong in `src/assets`.
- Images over 1 MB did not display in the rendered view once committed. The
  Contents API answers 200 with empty content above that size, producing a
  truncated data URL; committed images are now read through the Blobs API,
  which carries up to 100 MB.
- The rendered view re-downloaded every image on each re-render. Resolved
  images are cached for the open document, and images just committed are kept
  in memory rather than fetched back from GitHub.

## [1.0.0] - 2026-07-08

### Added
- Electron desktop app with CodeMirror markdown editor pane and acrylic custom chrome.
- GFM formatting toolbar: inline styles (bold/italic/strike/code) and block formatting
  (headings, blockquotes, lists), plus insert actions for links, images, code blocks,
  tables, and horizontal rules.
- Collapsible frontmatter panel with key-value editing and round-trip parsing.
- Live preview pipeline (markdown-it with GFM, footnotes, KaTeX) sanitized via DOMPurify.
- File open/save with frontmatter round trip, undo-history reset on load, and a
  close-guard prompt for unsaved changes.
- Security hardening for navigation, IPC, and rendered content (including KaTeX
  MathML and Mermaid diagrams), with regression tests against `javascript:` hrefs
  and iframe-based XSS.

[Unreleased]: https://github.com/jdtimothy/MarkPad/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/jdtimothy/MarkPad/releases/tag/v1.0.0
