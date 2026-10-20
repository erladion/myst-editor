# mysteditor

A WYSIWYG editor for Sphinx + MyST Markdown, aimed at writers who shouldn't have to
see Markdown syntax. An Electron app shipped as an AppImage.

## Status: phase 2 — MVP desktop app

Open a documentation folder and edit its pages as formatted documents:

- **Project:** finds `conf.py` (in the folder, `docs/`, `docs/source/`, …) and reads
  `myst_enable_extensions`, so the editor parses the same MyST dialect as the project's
  Sphinx build. For example, without `colon_fence`, `:::{note}` stays plain text, and
  new callouts are written with backtick fences.
- **Sidebar:** pages listed by their title, with folders and a filter.
- **Editing:** headings, bold/italic/code/strike, links, lists, quotes. Markdown
  shortcuts (`# `, `- `, `1. `, `**bold**`, `` `code` ``) work while typing.
- **MyST constructs:**
  - callouts with a type switcher and editable title
  - figures with image preview
  - dropdowns, tabs, cards
  - code blocks with a language field
  - math rendered with KaTeX (the source shows while the cursor is in it)
  - roles as chips; `{doc}` links show the page title, Ctrl+click opens the page
  - the toctree as a clickable table of contents
  - an Insert menu for callouts, figures, code, equations and cross-references
- **Everything else is still safe:** unknown directives, tables, front matter and HTML
  show as cards with a preview, and can be edited as source.
- **Saving:**
  - autosave, writing only the lines that changed
  - each save re-parses its own output, and refuses (with a warning) if the page
    wouldn't read back the same
  - atomic writes
  - external changes reload, or are flagged if there are unsaved edits
- **Markdown view:** toggle (Ctrl+/) to see or edit the raw source.

## How it works

```
.md ──myst-parser──▶ mdast ──▶ ProseMirror doc ──(edits)──▶ serializer ──▶ .md
                        └── source map: exact original text of every block ──┘
```

- `src/core/`: the round-trip engine, free of UI code and unit-tested.
  - `parse.ts` uses myst-parser (mystmd) for block structure. It cuts each container
    (document, directive body, list item, blockquote) into segments and records each
    block's exact source.
  - `serialize.ts` writes unchanged blocks verbatim. Edited blocks are serialized
    fresh, keeping the original fence, directive header, list marker and padding,
    emphasis style and link style.
  - `document.ts` handles load/save, plus the save verification.
  - `project-config.ts` reads `conf.py`.
- `src/main/`: the Electron main process. It handles project discovery, file access
  sandboxed to the project (symlinks included), the `myst-asset://` protocol for
  images, file watching and the menu.
- `src/preload/`: a narrow typed API (`window.myst`) for the sandboxed renderer.
- `src/renderer/`:
  - React app chrome
  - ProseMirror editor (`editor/`): setup, commands, and DOM node views for MyST
    constructs
  - `workspace.ts`: open documents, autosave and conflicts

## Round-trip results

Test corpus: 176 real documentation files from MyST-Parser, MyST-NB, sphinx-design,
sphinx-book-theme, sphinx-exercise and the-littlest-jupyterhub, plus `corpus/`.

| Check | Result |
|---|---|
| Unedited files round-trip byte-for-byte | 176/176 (100%) |
| Serializing everything from scratch re-parses to the same document | 175/176 (99.4%) |
| Typing one character (also inside formatting) changes exactly one line | 3996/4019 (99.4%) |
| …and the result re-parses to the edited document | 4019/4019 (100%) |
| Blocks shown as cards rather than rich | 7.3% |
| Parse time | ~8 ms/file average, ~200 ms for a 2,000-line changelog |

The remaining 0.6% produce correct output but touch neighbouring lines in the same
paragraph, because the parse tree doesn't record some spellings:

- needless escapes like `\'` are dropped
- `[x](<url>)` becomes `[x](url)`
- literal `[brackets]` get escaped
- a document mixing `*em*` and `_em_` gets the dominant style

## Develop

```sh
npm install
npm run dev                  # app with hot reload
npm test                     # unit tests: round-trip, edits, save verification, project access
npm run test:e2e             # build, then drive the real app with Playwright
npm run typecheck
npm run dist                 # release/MyST-Editor-<version>-x86_64.AppImage
```

Other tools:

```sh
npm run roundtrip -- <docs-dir>...                  # round-trip report over real files
FUZZ_MARKS=1 VERBOSE=1 npm run roundtrip -- <dir>   # fuzz inside formatting too, show all failures
npx tsx scripts/debug-file.ts <file.md>             # first block that doesn't round-trip, and why
npx tsx scripts/structure.ts <file.md>              # block tree as the editor sees it
npx tsx scripts/screenshot.ts out.png [page] [px]   # screenshot the app on the e2e fixture
npm run icon                                        # re-render build/icon.png from build/icon.svg
```

`MYSTEDITOR_EXECUTABLE=release/linux-unpacked/mysteditor npx playwright test` runs the
e2e suite against a packaged build. The app takes a folder argument
(`mysteditor ~/src/project/docs`); otherwise it reopens the last project.

### Linux / WSL notes

- Electron needs `libasound2t64`, and running an AppImage needs `libfuse2t64`. Both
  are usually present on desktop distros; on a minimal Ubuntu or WSL install, run
  `sudo apt install libasound2t64 libfuse2t64`. Without FUSE, an AppImage still runs
  with `APPIMAGE_EXTRACT_AND_RUN=1` or `--appimage-extract-and-run`.
- If `npm run dev` starts Electron as plain Node ("does not provide an export named
  'BrowserWindow'"), the shell has `ELECTRON_RUN_AS_NODE=1` set, e.g. inherited from
  an editor's extension host. Unset it.

## Known limitations / follow-ups

- Shown as cards with source editing, not yet rich-editable: GFM tables,
  `list-table`, definition lists, footnote definitions, `{image}`, front matter.
- `conf.py` is read with a regex for the common literal forms of
  `myst_enable_extensions`; computed values need Sphinx itself (phase 3).
- Cross-reference targets aren't checked yet; `{ref}` chips show the label, not the
  section title.
- Pages are listed from the file system, not from the toctree hierarchy.
- No find/replace yet, and no image picker. Figures take a typed path.
- One e2e failure (a `toHaveText` assertion) was seen once in 8 runs and not
  reproduced since.
- `npm audit` reports DoS-class advisories in markdown-it 13 / linkify-it 4, which
  myst-parser pins. Low risk for a local editor opening the user's own files (the
  affected linkify/smartquotes paths are disabled); revisit when myst-parser updates.
- Relies on prosemirror-view's internal `domObserver.flush()` to read the cursor
  position before handling keys (see `editor/setup.ts`). Without it, a fast key press
  after a click can act on a stale cursor in Chromium.

## Roadmap

1. ~~Round-trip spike~~ ✅
2. ~~MVP: Electron shell, project folder, page tree, rich editor for MyST, Markdown
   view, verified autosave, AppImage~~ ✅
3. Sphinx integration: bundled `uv` manages a per-project Python environment from the
   project's requirements; background builds; real preview; cross-reference
   autocomplete and validation; toctree-based navigation; Sphinx warnings shown inline.
4. Custom extensions: Sphinx-rendered previews of unknown directives, and per-project
   option forms.
5. Tables: create and edit tables visually, including row and column spans.
   - Open question: GFM tables and `list-table` can't express spans. Options are reST
     grid tables in `{eval-rst}`, an extension directive such as `flat-table`, or raw
     HTML (HTML output only). Possibly keep GFM until a writer merges cells, then
     switch format.
6. Advanced view: pure Markdown editing next to a live preview, hiding the formatting
   toolbar. For technical writers who prefer the source. The preview could come from
   the phase 3 Sphinx build.
7. Packaging: an RPM target alongside the AppImage. It can declare its dependencies
   and doesn't need FUSE, which RHEL 9 doesn't install by default.
8. Git, last:
   - open a repository from an HTTPS or SSH link, cloning it locally
   - commit changes from the app
   - Open questions: bundled git vs. the system's, and writer-friendly
     authentication (SSH keys, HTTPS tokens).
