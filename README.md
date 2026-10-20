# mysteditor

A WYSIWYG editor for Sphinx + MyST Markdown, aimed at writers who shouldn't have to
see Markdown syntax. An Electron app for Linux (AppImage, RPM, .deb) and Windows.

## Status: phase 8 — git

Open a documentation folder and edit its pages as formatted documents:

- **Projects:** finds every Sphinx `conf.py` under the opened folder, so one folder
  can hold several projects (say `user-guide/` and `admin-guide/` sharing a `.venv`).
  A `conf.py` only counts if it looks like Sphinx configuration and has a root
  document next to it, and virtualenvs are skipped whatever they're called. Each page
  belongs to the nearest project above it and is parsed with that project's
  `myst_enable_extensions`, matching its Sphinx build. For example, without
  `colon_fence`, `:::{note}` stays plain text and new callouts use backtick fences.
  Pages outside every project are listed as "Other files".
- **Opening** a large folder shows what it's doing (finding pages, reading titles).
  Folders such as `.venv`, `node_modules` and `.git` are never scanned or watched.
- **Sidebar:** pages listed by their title, with folders and a filter, in one section
  per project when there are several (with the folder added when two projects have
  the same name). Once built, it follows the toctree, and entries fold away.
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
  - an Insert menu for callouts, images, figures, code, equations, cross-references
    and link targets (`(label)=`, labelled from the heading). Choose… picks an image;
    one from outside the folder is copied into an `images/` folder next to the page.
- **Tables:** Markdown tables are edited as tables:
  - Tab and Shift+Tab move between cells. Enter moves down a row, adding one at the
    bottom.
  - A table toolbar inserts and deletes rows and columns, and sets column alignment.
  - **Merged cells** use your project's span roles (see `[tables]` below): a merged
    cell is written `{colspan}`2` text` or `{rowspan}`2` text`, and the cells it
    covers as empty `| |`.
  - Unedited tables are kept byte-for-byte. Edited ones keep their style: padded or
    compact columns, `| --- |` or `|-----|` delimiters.
  - Tables the model can't hold exactly stay as cards, kept as written and previewed
    from the build: a covered cell with content, a span past the edge, or more cells
    than the header.
- **HTML in pages** shows as what it does, in text and in table cells: `<br>` breaks
  the line, `<ul>`/`<ol>`/`<li>` show bullets and numbers, and the text between
  `<b>`, `<i>`, `<sub>` and similar tags shows formatted. Selecting a hidden tag shows
  it. HTML blocks render in their card. Only plain elements are rendered, never
  scripts, styles or event handlers, and the HTML is saved exactly as written.
- **Everything else is still safe:** unknown directives, tables, front matter and HTML
  show as cards with a preview, and can be edited as source.
- **Saving:**
  - autosave, writing only the lines that changed
  - each save re-parses its own output, and refuses (with a warning) if the page
    wouldn't read back the same
  - atomic writes
  - external changes reload, or are flagged if there are unsaved edits
- **Dark mode:** View → Appearance: light, dark, or the same as the system.
- **Markdown view** (Ctrl+/, remembered): for writers who prefer the source.
  - **Source editor:** syntax highlighting, MyST roles, directive names, options and
    targets picked out, find and replace (Ctrl+F), and Sphinx warnings in the gutter
    on their lines.
  - **Preview:** **Live** (the formatted view, read-only, as you type), **As built**
    (the Sphinx page), or **Off**. The live preview follows the part of the source
    you're in, and clicking a block jumps to its lines.
  - **Saving:** the text is saved exactly as typed. The formatting toolbar is hidden.
  - **Switching back** re-reads the text into the formatted editor.

With the folder's permission, the real Sphinx build also runs in the background, one
build per project:

- **Trust prompt:** building runs the projects' `conf.py` files (arbitrary Python),
  so the app asks once per opened folder, covering all its projects, and remembers
  the answer and the environment chosen.
- **Where Python comes from**, chosen in the trust prompt and changeable from the
  status bar:
  - **An environment already on the computer:** a `.venv`/`venv` in or above the
    projects (up to the repository root, so a shared one is found even when a single
    project's folder is opened), the active virtualenv, or the system `python3`, if
    it has Sphinx and MyST-Parser.
    It's used as-is and nothing is downloaded, which makes it the option for
    air-gapped machines and for keeping a known-good setup (e.g. Python 3.9 with
    older Sphinx). Any other interpreter can be picked with Browse.
  - **A private environment:** a bundled `uv` creates one per project, outside the
    repo, with its own downloaded Python. Requirements come from
    `.readthedocs.yaml`, a docs `requirements*.txt`, a `pyproject.toml` docs extra,
    or, as a fallback, are guessed from `conf.py`'s extensions and theme. It's
    rebuilt when they change, and once set up it needs no network. Without internet,
    setup stops within seconds with a clear message pointing to the first option.
- **Incremental builds** after every save, of the saved page's project only, in about
  a second for small projects. Changes to files outside every project, such as a
  shared extension module, rebuild them all.
- **Reopening a project** shows the last build's contents, references and problems
  at once, and only builds what changed since: on a 1,500-page project, 2 seconds
  instead of a 44-second full build. It starts afresh when the Python, a `.py` file
  (a local extension) or a capabilities file changed in the meantime.
- **Files a build writes itself** (an extension that generates pages or data) don't
  set off build after build: rewrites with the same content are ignored, and a file
  that changes during two builds in a row is taken to be build output.
- **Problems:** Sphinx warnings with page and line, in a panel and marked on the
  offending blocks. Clicking one jumps there.
- **Cross-references:** `{ref}` chips show the real section title, `{doc}` chips the
  page title. Broken `{ref}`/`{doc}`/`{term}` targets are flagged. The Insert
  cross-reference dialog autocompletes labels, pages and terms.
- **Contents:** the sidebar follows the toctree hierarchy, with pages outside it
  listed separately. A Files view is still available.
- **Preview:** the page as Sphinx actually builds it, theme included, beside the
  editor and refreshed after each build.
- **Block previews:** cards for blocks the editor can't render itself (custom
  directives, tables, definition lists, raw HTML) show the build's output for that
  block, marked "as built". This is the only way to see what a custom extension
  generates, such as a directive that builds content from its options, or a table
  with spans from a custom role. Each preview is a sandboxed frame on the build's own
  origin, using the page's theme, so HTML from the build never runs in the editor.
  Cards whose block produced no output keep their source view.

**Git**, through the computer's own `git`, so it works with any git server (GitLab,
Gitea, Bitbucket, Azure DevOps, a plain SSH host, GitHub) and uses the writer's
existing SSH keys and credential helpers:

- **Get from a repository:** paste an HTTPS or SSH link (or a local path) on the
  welcome screen or under File → Clone Repository…, pick where to save it, and the
  cloned folder opens.
- **Status bar:** the branch, how many files changed, and ↑/↓ for commits not yet
  pushed or new on the server. Clicking it opens the changes panel.
- **Changes panel:** changed files by page title, each with a checkbox, and a "What
  did you change?" message. **Commit**, **Commit and push**, **Push**, and **Get
  latest**. Unsaved pages are saved first. Getting the latest only fast-forwards, so
  a writer is never left in a merge; if both sides have new commits, the panel says
  so in plain words.
- **Sign-in:** git's and ssh's questions (username, password or token, key
  passphrase, "trust this server?") appear as dialogs in the app, never in a hidden
  terminal. They travel over a private socket with a random token.
- **Who is committing:** if git has no name and email yet, the first commit asks for
  them, for all repositories or just this one.
- Errors are explained plainly (wrong password, server unreachable, push rejected
  because the server has newer commits).

## Project settings

A `.mysteditor.toml` next to a `conf.py` (or at the opened folder's root, for all its
projects) tells the editor about a project's own extensions. Files are merged from
the root down, are reloaded when they change, and mistakes show up as "Settings: N
problems" in the status bar.

```toml
# A directive with a Markdown body: edited like a callout, with an options form.
[directives.company-callout]
label = "Internal note"
tone = "warning"            # note | info | tip | warning | danger | neutral
body = "markdown"           # markdown | text (edited as code) | none (a card)
argument = "Title"          # leave out if the directive takes no argument
insert = true               # offer it in the Insert menu (default)
[directives.company-callout.options.audience]
label = "Audience"
choices = ["internal", "partners", "public"]
default = "internal"        # used when inserting
[directives.company-callout.options.draft]
flag = true                 # a checkbox: present or absent

# Merged table cells, written the way the project's extension reads them:
# {colspan}`2` text, with covered cells left empty. Merging is offered once set.
[tables]
colspan_role = "colspan"
rowspan_role = "rowspan"

# A role: a labelled chip, and Ctrl+click opens the link.
[roles.jira]
label = "Jira"
url = "https://jira.example.com/browse/{value}"

# Conditional content: <!-- if: X or Y --> … <!-- endif -->, and
# <!-- if-inline: X --> … <!-- endif-inline --> inside a paragraph.
[conditions]
capabilities = "capabilities.json"   # relative to this file
key = "product.capabilities"         # where the names are in the JSON (optional)
block = ["if", "endif"]              # the defaults
inline = ["if-inline", "endif-inline"]
case_sensitive = true
```

The capabilities file can be a list of names, an object keyed by name, or a list of
objects with a `name`/`id`, optionally under `key`.

With `[conditions]` set:

- Each condition shows as a "Shown only when …" line, with a stripe beside its
  content. Nested conditions stack stripes.
- **Condition…** in the toolbar wraps the current block, or the selected words, using
  a capability checklist or an expression (`and`, `or`, `not`, parentheses;
  precedence `not` > `and` > `or`). Unknown capabilities and malformed expressions
  are flagged.
- Conditions can be edited or removed, which removes both markers and keeps the
  content.
- **View as** dims what a build with a given set of capabilities wouldn't show.
  Nothing in the file changes.

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
  sandboxed to the opened folder (symlinks included), the `myst-asset://` protocol for
  images, file watching and the menu.
  - `sphinx/`: requirements discovery, environments (uv-managed or existing), and a
    build manager per project (debounced incremental builds, merged warnings). The
    preview is served over `myst-build://<project id>/`.
- `src/shared/projects.ts`: which project a page belongs to. All page paths are
  relative to the opened folder.
- `resources/sphinx/mysteditor_build.py`: the build driver. It runs Sphinx through
  its Python API and exports the toctree, titles, every cross-reference target and
  phase-tagged warnings as JSON. It also exports HTML fragments of previewable
  blocks per page, keyed by source line (`<output>/_mysteditor/fragments/`), which
  `src/main/sphinx/fragments.ts` serves as per-block preview pages. Sphinx only re-reports warnings for what an
  incremental build touched, so `mergeWarnings` (in `src/shared/sphinx.ts`) keeps
  the rest.
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
npm run fetch-uv             # download the pinned, checksum-verified uv into resources/uv/
npm run dev                  # app with hot reload
npm test                     # unit tests: round-trip, edits, save verification, project access, Sphinx plumbing
npm run test:sphinx          # integration: real uv + Sphinx on the fixture (downloads packages once)
npm run test:e2e             # build, then drive the real app with Playwright
npm run typecheck
npm run dist                 # AppImage, RPM and .deb in release/ (uv bundled in each)
npm run dist:appimage        # AppImage only (no rpmbuild needed)
npm run dist:win             # Windows installer (run on Windows)
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
e2e suite against a packaged build. The e2e and integration tests share a Sphinx data
folder (Python, uv cache) in the system temp dir, so downloads happen once; set
`MYSTEDITOR_SPHINX_DATA` to use another. The app takes a folder argument
(`mysteditor ~/src/project/docs`); otherwise it reopens the last project.

In development the app uses `resources/uv/uv` if fetched, otherwise `uv` from `PATH`.
Per-project environments, builds and logs live in `<userData>/sphinx/`.

### Installing

- **RHEL 9, Rocky/Alma, Fedora, openSUSE:** `sudo dnf install ./MyST-Editor-<version>-x86_64.rpm`
  (`zypper install` on openSUSE). Dependencies are declared as library sonames, so
  each distribution's own packages satisfy them, and no FUSE is needed. It installs
  to `/opt/MyST Editor/` with a `mysteditor` command and a menu entry. The
  post-install script only makes Chromium's sandbox setuid on systems without user
  namespaces.
- **Debian 12+, Ubuntu 22.04+, Mint:** `sudo apt install ./MyST-Editor-<version>-amd64.deb`.
  It installs to `/opt/MyST Editor/` with a `mysteditor` command and a menu entry, and
  recommends `git`.
- **Windows 10 and 11:** run `MyST-Editor-Setup-<version>.exe`. It installs for the
  current user (no administrator rights), with Start menu and desktop shortcuts and
  an uninstaller under Settings → Apps. The installer isn't code-signed yet, so
  Windows shows "Windows protected your PC" the first time: choose **More info →
  Run anyway**. Git features need [Git for Windows](https://git-scm.com/download/win);
  its sign-in window (Git Credential Manager) handles HTTPS passwords and tokens.
  Pages with Windows line endings (CRLF) keep them.
- **Anything else:** the AppImage. It needs `libfuse2`, or run it with
  `--appimage-extract-and-run`.
- **Git features** need `git` installed (`dnf install git`, `apt install git`, or Git
  for Windows). Without it the rest of the app works as before.

Building the RPM needs `rpmbuild`: `sudo dnf install rpm-build` on Fedora/RHEL, or
`sudo apt install rpm` on Debian/Ubuntu.

### Air-gapped machines

Prepare a documentation environment with the packages copied over as wheel files,
then choose it in the app. It's found automatically if it's a `.venv`/`venv` in the
project:

```sh
python3 -m venv docs/.venv
docs/.venv/bin/pip install --no-index --find-links /path/to/wheels -r docs/requirements.txt
```

The wheels must include Sphinx, MyST-Parser and every extension and theme `conf.py`
uses. On RHEL 9's system Python 3.9 that means Sphinx 7.4 or older, since Sphinx 8
needs Python 3.10. The build driver works with Sphinx 5.3 and later (tested on 5.3.0,
7.1.2 and 9.1.1).

With an internal PyPI mirror instead, the private environment works too: uv reads
`UV_DEFAULT_INDEX` and `UV_PYTHON_INSTALL_MIRROR` from the environment.

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
- The editor's MyST dialect comes from a regex over `conf.py` (the common literal
  forms of `myst_enable_extensions`), not from the build. It could now be taken from
  the running Sphinx instead.
- The preview shows the last *saved and built* state, about a second behind typing,
  and doesn't scroll in step with the editor yet. The same goes for block previews.
- Block previews are pictures: interactive output (tabs, toggles) can't be clicked
  in them. Blocks whose output has no source line, and content pulled in by
  `{include}`, have no preview. Rendering the fragments adds a little to each build.
- Warning locations are mapped through the saved file's structure. Edits made after
  the save can shift markers slightly until the next build.
- Only `{ref}`, `{doc}`, `{term}` and `[](target)` are checked for broken targets.
  Domain roles like `{py:func}` often point at other projects through intersphinx,
  so they aren't flagged.
- Each project's private environment takes disk space in `<userData>/sphinx/`, and
  there's no cleanup UI yet.
- An existing environment is only checked for Sphinx and MyST-Parser. A missing
  extension shows up as a build failure naming the module.
- `intersphinx` in `conf.py` tries to download other projects' inventories on every
  build, which offline produces a warning each time.
- The private environment's Python version comes from `.readthedocs.yaml` or
  `.python-version` (default 3.12). `requires-python` in `pyproject.toml` isn't read
  yet.
- With several projects, one environment choice covers them all; there's no
  per-project override yet. Links between the projects (intersphinx) aren't
  resolved by the editor, and each project builds separately.
- Projects are searched for up to six folders deep.
- Installing the project itself (`pip install -e .` from `.readthedocs.yaml` or a
  pyproject docs extra) can fail for projects with compiled code. Details are in the
  build log.
- No find/replace yet, and no image picker. Figures take a typed path.
- Editing a padded table re-pads every row of a column when its widest cell changes,
  as table formatters do. Cells hold one line: line breaks can't be typed in a cell,
  and merged cells' text is joined with a space. With both spans on one cell, the
  editor writes `{colspan}` before `{rowspan}`, and reads them in either order.
- Custom syntax built on MyST's own extension points (`{role}` and `{directive}`) is
  parsed and preserved exactly. Syntax an extension finds in the raw text instead
  (for example a source-read preprocessor matching `[[...]]`) is ordinary text to
  the editor. It's preserved until the paragraph is edited, but then its
  punctuation may be escaped (`\[\[`), which the extension would no longer match.
  Planned: declaring such patterns in `.mysteditor.toml` (extensions tier 5).
- An inline condition can't start at the beginning of a line: there, `<!--` would
  start an HTML block. The editor refuses and suggests selecting the whole paragraph.
- Conditions are matched as written. Markers inside code blocks are code, even if the
  extension strips them from the raw text.
- One e2e failure (a `toHaveText` assertion) was seen once early in phase 2 and not
  reproduced since.
- In the Markdown view, Enter inside a list continues it (CodeMirror's Markdown
  behaviour). Preview sync follows blocks, not exact lines inside a long block, and
  the live preview re-renders the whole page on each pause in typing, which may lag
  on very long pages.
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
3. ~~Sphinx integration: bundled uv and per-project environments, background builds,
   real preview, cross-reference autocomplete and validation, toctree navigation,
   warnings shown inline~~ ✅
4. Custom extensions, in tiers:
   1. ~~Never break what the editor doesn't understand~~ ✅ Unknown syntax is kept
      byte-for-byte, shown as a card and editable as source.
   2. ~~A per-project editor config file (`.mysteditor.toml`)~~ ✅ Declared
      directives and roles, option forms, and conditional content (see [Project
      settings](#project-settings)).
   3. ~~Sphinx-rendered previews~~ ✅ Cards for blocks the editor can't render itself
      (custom directives, tables, definition lists, raw HTML) show what the
      project's own build makes of them.
   4. JavaScript plugins, only if tiers 2–3 aren't enough, since they mean trusting
      code shipped in a repo.
   5. Custom raw-text syntax (patterns an extension recognises in the source, not
      MyST roles or directives): declare its patterns so the editor keeps those spans
      verbatim. Today they're ordinary text, and editing such a paragraph may escape
      their punctuation (see Known limitations).
5. ~~Tables: create and edit tables visually, including row and column spans~~ ✅
   GFM tables, with spans written through the project's own roles (`[tables]`).
   Still cards: `{list-table}` and grid tables in `{eval-rst}`.
6. ~~Advanced view: pure Markdown editing next to a live preview, hiding the
   formatting toolbar~~ ✅
7. ~~Packaging: an RPM target alongside the AppImage~~ ✅ Verified by inspecting
   the package and running the e2e suite on its payload. Not yet installed on a real
   RHEL 9 machine.
8. ~~Git: clone from an HTTPS or SSH link, commit, push and get the latest~~ ✅
   Uses the system `git`, so any git server works and sign-in goes through the
   writer's own keys and credential helpers, with prompts answered in the app.
