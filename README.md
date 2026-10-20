# MyST Editor

A WYSIWYG editor for Sphinx documentation written in MyST Markdown, for writers who
shouldn't have to see Markdown syntax. Open a documentation folder (or get one from a
git repository), edit its pages as formatted documents, and see them as Sphinx
builds them. Only what you change is saved: the rest of every file stays exactly as
it was written.

For Linux (AppImage, RPM, .deb) and Windows. Downloads are on the
[releases page](https://github.com/erladion/myst-editor/releases).

## Install

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
- **Anything else on Linux:** the AppImage. It needs `libfuse2`, or run it with
  `--appimage-extract-and-run`.

Git features need `git` (`dnf install git`, `apt install git`, or Git for Windows).
Without it, everything else works.

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

## What it does

### Editing pages

- **Formatting:** headings, bold/italic/code/strike, links, lists, quotes. Markdown
  shortcuts (`# `, `- `, `1. `, `**bold**`, `` `code` ``) work while typing.
- **MyST constructs:**
  - callouts with a type switcher and editable title
  - figures and images with a preview
  - dropdowns, tabs, cards
  - code blocks with a language field
  - math rendered with KaTeX (the source shows while the cursor is in it)
  - roles as chips; `{doc}` links show the page title, Ctrl+click opens the page
  - the toctree as a clickable table of contents
  - an Insert menu for callouts, images, figures, tables, code, equations,
    cross-references and link targets (`(label)=`, labelled from the heading)
- **Tables** are edited as tables:
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
- **Pictures:** paste a screenshot, or drop image files onto a page, and they appear
  where the cursor or the drop is. Pasted pictures are saved in an `images/` folder
  next to the page with a dated name. A dropped file inside the folder is used where
  it is; one from elsewhere is copied in. When the clipboard holds text as well (copied
  from a document or web page), the text is pasted. Insert → Image… and Figure… have
  a **Choose…** button, and double-clicking a picture changes it or its description.
- **HTML in pages** shows as what it does, in text and in table cells: `<br>` breaks
  the line, `<ul>`/`<ol>`/`<li>` show bullets and numbers, and the text between
  `<b>`, `<i>`, `<sub>` and similar tags shows formatted. Selecting a hidden tag shows
  it. HTML blocks render in their card. Only plain elements are rendered, never
  scripts, styles or event handlers, and the HTML is saved exactly as written.
- **Everything else is still safe:** unknown directives, front matter and the like
  show as cards with a preview, and can be edited as source.
- **Conditional content** for projects with a conditions extension: see
  [Project settings](#project-settings).
- **Saving:**
  - autosave, writing only the lines that changed
  - each save re-parses its own output, and refuses (with a warning) if the page
    wouldn't read back the same
  - atomic writes, and a page's line endings (LF or Windows CRLF) are kept
  - changes made outside the app reload, or are flagged if there are unsaved edits
- **Page history** (File → Page History…, or right-click a page → History…): the
  page's earlier versions, newest first:
  - the app's own: before saving a page, it keeps the page as it was, at most once
    every 10 minutes (the last 50 per page, for 30 days, in the app's data folder,
    not the repository), so a paragraph deleted by mistake can still be found even
    if it was never committed;
  - every commit that changed it, with who and why (following renames).

  Each shows as **Changes since** (what's different now) or **This version**
  (formatted). **Restore this version** puts it back, and keeps the page as it was
  first, so a restore can be undone too.

### Pages and the table of contents

- **Projects:** every Sphinx `conf.py` under the opened folder is found, so one folder
  can hold several projects (say `user-guide/` and `admin-guide/` sharing a `.venv`).
  A `conf.py` only counts if it looks like Sphinx configuration and has a root
  document next to it. Each page belongs to the nearest project above it and is
  parsed with that project's `myst_enable_extensions`, matching its Sphinx build: for
  example, without `colon_fence`, `:::{note}` stays plain text and new callouts use
  backtick fences. Pages outside every project are listed as "Other files".
- **Sidebar:** pages by title, with a filter, in one section per project when there
  are several (with the folder added when two projects have the same name). Once
  built, it follows the toctrees, with entries that fold away, and pages no table of
  contents lists under "Not in the contents". A Files view shows the folders instead.
- **New page:** the sidebar button, File → New Page… or Ctrl+N. It asks for a title,
  a folder and which page's table of contents should list it (the nearest index page
  by default), and adds the entry at the end, unless a `:glob:` pattern already takes
  the page in.
- **Reorder:** drag a page in the contents: onto the top or bottom edge of another
  page to go before or after it, or onto its middle to go into its contents (a page
  without a toctree gets one). Right-click offers Move up / Move down. Only the
  toctree entries change, written relative to their page; the files stay where they
  are. Pages under "Not in the contents" can be dragged in.
- **Delete page:** right-click a page, or File → Delete Page…. It goes to the trash and
  out of every table of contents that lists it.
- **Opening** a large folder shows what it's doing (finding pages, reading titles).
  Folders such as `.venv`, `node_modules` and `.git` are never scanned or watched.
  A folder only counts as a Python environment when it is one (whatever its name),
  and `build/` or `dist/` only as build output when it holds no pages. Symlinked
  pages and folders inside the opened folder are followed.

### Getting around

- **Go to page** (Ctrl+P, or File → Go to Page…): type part of a page's title or file
  name, then pick it with the arrow keys and Enter. Pages opened lately come first.
- **Outline** (Ctrl+Shift+O, or View → Outline): the open page's headings beside it,
  in both views. Click one to go there; the one you're in is highlighted. It stays
  open until hidden.
- **Where you left off:** a folder reopens on the page last open, scrolled where it
  was, and each page keeps its place when switching between pages.
- **Recent folders** are listed on the welcome screen and under File → Open Recent.

### Markdown view

Ctrl+/ (remembered) switches to the Markdown source, for writers who prefer it:

- **Source editor:** syntax highlighting, MyST roles, directive names, options and
  targets picked out, find and replace (Ctrl+F), and Sphinx warnings in the gutter
  on their lines. Pasted and dropped pictures become `![](images/…)`.
- **Preview:** **Live** (the formatted view, read-only, as you type), **As built**
  (the Sphinx page), or **Off**. The live preview follows the part of the source
  you're in, and clicking a block jumps to its lines.
- **Saving:** the text is saved exactly as typed. The formatting toolbar is hidden.
- **Switching back** re-reads the text into the formatted editor.

### Building with Sphinx

With the folder's permission, the real Sphinx build runs in the background, one build
per project:

- **Trust prompt:** building runs the projects' `conf.py` files (arbitrary Python),
  so the app asks once per opened folder, covering all its projects, and remembers
  the answer and the environment chosen.
- **Where Python comes from**, chosen in the trust prompt and changeable from the
  status bar:
  - **An environment already on the computer:** a `.venv`/`venv` in or above the
    projects (up to the repository root, so a shared one is found even when a single
    project's folder is opened), the active virtualenv, or the system Python, if it
    has Sphinx and MyST-Parser. It's used as-is and nothing is downloaded, which makes
    it the option for air-gapped machines and for keeping a known-good setup (e.g.
    Python 3.9 with older Sphinx). Any other interpreter can be picked with Browse.
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
- **Environment variables:** builds get the projects' `[sphinx.env]` (see
  [Project settings](#project-settings)) and the writer's own, set in the Sphinx
  dialog (click the build status) and kept by the app per folder, not in the
  repository. The writer's win. Changing either builds again from scratch. They're
  stored as plain text in the app's settings, so they're no place for passwords.
- **Problems:** Sphinx warnings with page and line, in a panel and marked on the
  offending blocks. Clicking one jumps there.
- **Cross-references:** `{ref}` chips show the real section title, `{doc}` chips the
  page title. Broken `{ref}`/`{doc}`/`{term}` targets are flagged. The Insert
  cross-reference dialog autocompletes labels, pages and terms.
- **Preview:** the page as Sphinx actually builds it, theme included, beside the
  editor and refreshed after each build.
- **Block previews:** cards for blocks the editor can't render itself (custom
  directives, tables, definition lists, raw HTML) show the build's output for that
  block, marked "as built". This is the only way to see what a custom extension
  generates, such as a directive that builds content from its options, or a table
  with spans from a custom role. Each preview is a sandboxed frame on the build's own
  origin, using the page's theme, so HTML from the build never runs in the editor.
  Cards whose block produced no output keep their source view.

### Git

Through the computer's own `git`, so it works with any git server (GitLab, Gitea,
Bitbucket, Azure DevOps, a plain SSH host, GitHub) and uses the writer's existing SSH
keys and credential helpers:

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

### Appearance

View → Appearance: light, dark, or the same as the system. Built-page previews keep
their Sphinx theme's own colours on Linux.

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

# Environment variables for Sphinx builds, for a conf.py that reads os.environ.
[sphinx.env]
PRODUCT = "enterprise"

# Optional colours, by condition as written: purple, orange, teal, magenta, blue,
# olive, green, slate, or "#rrggbb".
[conditions.colors]
CapabilityX = "teal"
"CapabilityX or CapabilityY" = "orange"
```

The capabilities file can be a list of names, an object keyed by name, or a list of
objects with a `name`/`id`, optionally under `key`.

With `[conditions]` set:

- Each condition shows as a "Shown only when …" line, with a stripe beside its
  content. Nested conditions stack stripes, one per condition.
- Each condition has its own colour, the same on every page: capabilities take the
  palette in the order the capabilities file lists them, so the first eight always
  differ, and combinations get one of their own. `[conditions.colors]` picks them
  instead. **View as** shows each capability's colour.
- **Condition…** in the toolbar wraps the current block, or the selected words, using
  a capability checklist or an expression (`and`, `or`, `not`, parentheses;
  precedence `not` > `and` > `or`). Unknown capabilities and malformed expressions
  are flagged.
- Conditions can be edited or removed, which removes both markers and keeps the
  content.
- **View as** dims what a build with a given set of capabilities wouldn't show.
  Nothing in the file changes.

## Known limitations

- **Shown as cards with source editing**, not rich-editable: `{list-table}`, grid
  tables in `{eval-rst}`, definition lists, footnote definitions and front matter.
- **Table cells hold one line.** Line breaks can't be typed in a cell (a `<br>`
  written in the source shows as one), and merged cells' text is joined with a space.
  Editing a padded table re-pads every row of a column when its widest cell changes,
  as table formatters do. With both spans on one cell, the editor writes `{colspan}`
  before `{rowspan}`, and reads them in either order.
- **Find and replace** works in the Markdown view of one page. There's none in the
  formatted view, nor across pages.
- **Pages can't be renamed or moved** to another folder from the app yet. Reordering
  changes only the tables of contents.
- **Deleting a page** leaves links to it from other pages; they show as problems after
  the next build.
- **Pasted pictures** have no description until one is added (double-click the
  picture).
- **Scroll positions** are remembered in the formatted view, not yet in the Markdown
  view.
- **Getting the latest** only fast-forwards: when a colleague pushed while you have
  commits of your own, someone familiar with git has to merge them. There are no
  branches in the app.
- **Custom raw-text syntax:** syntax built on MyST's own extension points (`{role}`
  and `{directive}`) is parsed and preserved exactly. Syntax an extension finds in
  the raw text instead (for example a source-read preprocessor matching `[[...]]`) is
  ordinary text to the editor. It's preserved until the paragraph is edited, but then
  its punctuation may be escaped (`\[\[`), which the extension would no longer
  match. Planned: declaring such patterns in `.mysteditor.toml` (extensions tier 5).
- **Conditions:** an inline condition can't start at the beginning of a line, where
  `<!--` would start an HTML block; the editor refuses and suggests selecting the
  whole paragraph. Markers inside code blocks are code, even if the extension strips
  them from the raw text.
- **The MyST dialect** comes from a regex over `conf.py` (the common literal forms of
  `myst_enable_extensions`), not from the build.
- **Previews** show the last *saved and built* state, about a second behind typing,
  and the page preview doesn't scroll in step with the editor. Block previews are
  pictures: interactive output (tabs, toggles) can't be clicked in them. Blocks whose
  output has no source line, and content pulled in by `{include}`, have no preview.
  Warning markers can shift slightly after edits until the next build.
- **Broken targets** are only checked for `{ref}`, `{doc}`, `{term}` and `[](target)`.
  Domain roles like `{py:func}` often point at other projects through intersphinx,
  so they aren't flagged.
- **Environments:** each project's private environment takes disk space in
  `<userData>/sphinx/`, with no cleanup in the app yet. An existing environment is
  only checked for Sphinx and MyST-Parser; a missing extension shows up as a build
  failure naming the module. The private environment's Python version comes from
  `.readthedocs.yaml` or `.python-version` (default 3.12), not yet from
  `requires-python`. Installing the project itself (`pip install -e .`) can fail for
  projects with compiled code; details are in the build log.
- **Several projects in one folder** share one environment choice, and links between
  them (intersphinx) aren't resolved by the editor. Projects are searched for up to
  six folders deep.
- **Offline**, `intersphinx` in `conf.py` tries to download other projects'
  inventories on every build, which gives a warning each time.
- **The Windows installer isn't signed**, so Windows warns about it the first time.
- **Markdown view:** Enter inside a list continues it (CodeMirror's Markdown
  behaviour). The live preview re-renders the whole page on each pause in typing,
  which may lag on very long pages.
- `npm audit` reports DoS-class advisories in markdown-it 13 / linkify-it 4, which
  myst-parser pins. Low risk for a local editor opening the user's own files (the
  affected linkify/smartquotes paths are disabled); revisit when myst-parser updates.
- The editor relies on prosemirror-view's internal `domObserver.flush()` to read the
  cursor position before handling keys (see `editor/setup.ts`). Without it, a fast
  key press after a click can act on a stale cursor in Chromium.

## Roadmap

Done:

1. ~~Round-trip spike~~ ✅
2. ~~MVP: Electron shell, project folder, page tree, rich editor for MyST, Markdown
   view, verified autosave, AppImage~~ ✅
3. ~~Sphinx integration: bundled uv and per-project environments, background builds,
   real preview, cross-reference autocomplete and validation, toctree navigation,
   warnings shown inline~~ ✅
4. Custom extensions, in tiers:
   1. ~~Never break what the editor doesn't understand~~ ✅
   2. ~~A per-project editor config file (`.mysteditor.toml`)~~ ✅ Directives, roles,
      table spans, conditional content and build environment variables.
   3. ~~Sphinx-rendered previews~~ ✅
   4. JavaScript plugins, only if tiers 2–3 aren't enough, since they mean trusting
      code shipped in a repo.
   5. Custom raw-text syntax: declare the patterns an extension recognises in the
      source, so the editor keeps those spans verbatim (see Known limitations).
5. ~~Tables with row and column spans~~ ✅
6. ~~Markdown view with a live preview~~ ✅
7. ~~Packages: AppImage, RPM, .deb and a Windows installer~~ ✅ Tested by running the
   e2e suite on each package's contents, and on Windows natively. The RPM hasn't been
   installed on a real RHEL 9 machine yet.
8. ~~Git: clone, commit, push and get the latest, with any git server~~ ✅
9. ~~Large projects, dark mode, a colour per condition, adding, deleting and
   reordering pages, pasted pictures~~ ✅

Next, roughly in order:

- Git for teams: combine your commits with a colleague's when they don't overlap, a
  simple choice for real conflicts, and optionally branches and "send for review".
- Rename and move pages, updating tables of contents and `{doc}` links.
- Find and replace across pages.
- Automatic updates; a signed Windows installer; cleaning up unused environments.

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
  images, file watching (`watch.ts`: directories only on Linux, skipping virtualenvs
  and dependencies) and the menu.
  - `git/`: the system `git` with safe options, and `askpass.ts`, which answers git's
    and ssh's questions through the app over a private socket (a named pipe on
    Windows).
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
- `src/core/toctree.ts`: adding, removing and moving entries in a toctree's source,
  keeping the rest exactly as written. `src/renderer/src/pages.ts` uses it for new,
  deleted and reordered pages.
- `src/renderer/`:
  - React app chrome
  - ProseMirror editor (`editor/`): setup, commands, and DOM node views for MyST
    constructs; `html.ts` shows inline HTML safely; `images.ts` handles pasted and
    dropped pictures
  - `workspace.ts`: open documents, autosave, conflicts and line endings (a CRLF
    page stays CRLF)

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
npm run test:sphinx          # integration: real uv + Sphinx on the fixture, and git (downloads packages once)
npm run test:e2e             # build, then drive the real app with Playwright
npm run typecheck
npm run dist                 # AppImage, RPM and .deb in release/ (uv bundled in each)
npm run dist:appimage        # AppImage only (no rpmbuild needed)
npm run dist:win             # Windows installer (run on Windows)
```

Building the RPM needs `rpmbuild`: `sudo dnf install rpm-build` on Fedora/RHEL, or
`sudo apt install rpm` on Debian/Ubuntu.

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
`MYSTEDITOR_SPHINX_DATA` to use another. The e2e tests keep their files in one folder
under the temp dir, cleared before and after each run, and set
`MYSTEDITOR_TRASH=none` where they delete pages, so nothing lands in the desktop
trash. The app takes a folder argument (`mysteditor ~/src/project/docs`); otherwise it
reopens the last project.

In development the app uses `resources/uv/uv` (`uv.exe` on Windows) if fetched,
otherwise `uv` from `PATH`. Per-project environments, builds and logs live in
`<userData>/sphinx/`.

### Windows

The same commands work on Windows with Node 24 and Git for Windows; `npm run
fetch-uv` fetches the Windows `uv.exe`. GitHub's Windows runners keep their temporary
folder under an 8.3 short name (`C:\Users\RUNNER~1\…`), so tests should also pass
with `TEMP` set to a short-named folder: paths are compared as real, long names.

### Linux and WSL

- Electron needs `libasound2t64`, and running an AppImage needs `libfuse2t64`. Both
  are usually present on desktop distros; on a minimal Ubuntu or WSL install, run
  `sudo apt install libasound2t64 libfuse2t64`. Without FUSE, an AppImage still runs
  with `APPIMAGE_EXTRACT_AND_RUN=1` or `--appimage-extract-and-run`.
- If `npm run dev` starts Electron as plain Node ("does not provide an export named
  'BrowserWindow'"), the shell has `ELECTRON_RUN_AS_NODE=1` set, e.g. inherited from
  an editor's extension host. Unset it.

### Continuous integration and releases

`.github/workflows/ci.yml` runs the type check and all three test suites on Linux and
Windows for every push and pull request. Pushing a version tag releases:

```sh
npm version 0.4.0 --no-git-tag-version
git commit -am "Release 0.4.0"
git tag -a v0.4.0 -m "MyST Editor 0.4.0"
git push origin master v0.4.0
```

`release.yml` checks that the tag matches `package.json`, runs CI, builds the
AppImage, RPM and .deb on Linux and the installer on Windows, and publishes them with
`SHA256SUMS` as a GitHub release.
