# MyST Editor

A WYSIWYG editor for Sphinx documentation written in MyST Markdown, for writers who
shouldn't have to see Markdown syntax. Only what you change is saved; the rest of
every file stays exactly as written.

Downloads: [releases](https://github.com/erladion/myst-editor/releases).

## Install

- **RHEL 9, Rocky/Alma, Fedora:** `sudo dnf install ./MyST-Editor-<version>-x86_64.rpm`
- **Debian, Ubuntu, Mint:** `sudo apt install ./MyST-Editor-<version>-amd64.deb`
- **Other Linux:** the AppImage (needs `libfuse2`, or run it with `--appimage-extract-and-run`).
- **Windows:** `MyST-Editor-Setup-<version>.exe`. It's unsigned, so Windows warns the
  first time (**More info → Run anyway**). On managed PCs, run it as administrator.

Git features need `git` (Git for Windows on Windows).

**Air-gapped machines:** the app can build with a Python environment that's already
there, so nothing is downloaded. Make one from wheel files and choose it in the app
(a `.venv` in the project is found automatically):

```sh
python3 -m venv docs/.venv
docs/.venv/bin/pip install --no-index --find-links /path/to/wheels -r docs/requirements.txt
```

It needs Sphinx 5.3 or later, MyST-Parser, and every extension `conf.py` uses. On
RHEL 9's Python 3.9 that means Sphinx 7.4 or older.

## Using it

Open a documentation folder (or **Get from a repository…** to clone one). The first
time, the app asks whether to build it with Sphinx, which runs the project's
`conf.py`, and where Python should come from:

- an environment on the computer (a project `.venv`, or the system Python), or
- a private one the app sets up, from the project's requirements (needs internet once).

Builds then run in the background after every save, for links, problems and
previews. Right-click a page in the sidebar to see its history, rename or move it (links and
tables of contents pointing to it follow), delete it, or move it in the contents (or
drag it).

**Git:** the status bar shows the branch and your changes, and checks the server
every few minutes ("↓2 new"). Click the changes to commit, push, see or discard them,
and **Get latest**: your commits go on top of what's new (a rebase) and uncommitted
edits are kept. Where you and a colleague changed the same lines, the app asks, place
by place, what to keep. Click the branch (or Ctrl+Shift+B) to switch branch, or start
one from the latest `main`; uncommitted changes can stay with the branch you leave
and come back when you return. Pull requests stay in your git server.

| Shortcut | |
|---|---|
| Ctrl+P | Go to page |
| Ctrl+N | New page |
| Ctrl+Shift+O | Outline of the page |
| Ctrl+/ | Markdown view |
| Ctrl+F | Find and replace (Markdown view) |
| Ctrl+Shift+B | Switch branch |

View → Appearance switches between light and dark.

## Project settings

A `.mysteditor.toml` next to `conf.py` (or at the top of the folder, for all its
projects) tells the editor about the project's own extensions. It's reloaded when
saved, and mistakes show as "Settings: N problems" in the status bar. Everything is
optional:

```toml
# A directive, edited like a callout with a form for its options.
[directives.company-callout]
label = "Internal note"
tone = "warning"          # note | info | tip | warning | danger | neutral
body = "markdown"         # markdown | text (edited as code) | none (a card)
argument = "Title"        # leave out if it takes no argument
insert = true             # offer it in the Insert menu
[directives.company-callout.options.audience]
label = "Audience"
help = "Who it's for"
choices = ["internal", "partners", "public"]
default = "internal"
[directives.company-callout.options.draft]
flag = true               # a checkbox

# A role: a labelled chip; Ctrl+click opens the link.
[roles.jira]
label = "Jira"
url = "https://jira.example.com/browse/{value}"

# Merged table cells, written {colspan}`2` text, with covered cells empty.
[tables]
colspan_role = "colspan"
rowspan_role = "rowspan"

# Conditional content: <!-- if: X or Y --> … <!-- endif --> and
# <!-- if-inline: X --> … <!-- endif-inline -->.
[conditions]
capabilities = "capabilities.json"   # relative to this file
key = "product.capabilities"         # where the names are in it (optional)
block = ["if", "endif"]
inline = ["if-inline", "endif-inline"]
case_sensitive = true
[conditions.colors]                  # optional
CapabilityX = "teal"                 # purple, orange, teal, magenta, blue, olive, green, slate or "#rrggbb"

# Environment variables for Sphinx builds (writers can add their own in the app).
[sphinx.env]
PRODUCT = "enterprise"
```

Directives and roles that aren't declared still work: they're kept exactly as
written, shown as cards with a preview from the build, and editable as source.

## Known limitations

- `{list-table}`, grid tables, definition lists and footnotes are cards, edited as
  source. Table cells hold one line.
- No find and replace across pages.
- Syntax an extension finds in the raw text (say `[[...]]`), rather than through a
  role or directive, is ordinary text to the editor and may get escaped when its
  paragraph is edited.
- Previews show the last saved build, about a second behind typing.

## Development

```sh
npm install
npm run fetch-uv       # the bundled uv, checksum-verified
npm run dev            # the app, with hot reload
npm run typecheck
npm test               # unit tests
npm run test:sphinx    # integration: real uv, Sphinx and git
npm run test:e2e       # the built app, driven by Playwright
npm run dist           # AppImage, RPM and .deb in release/ (RPM needs rpmbuild)
npm run dist:win       # Windows installer (on Windows)
```

On WSL or a minimal Linux, Electron may need `libasound2t64`, and the AppImage
`libfuse2t64`. If `npm run dev` starts Electron as plain Node, unset
`ELECTRON_RUN_AS_NODE`.

**Releasing:** CI runs all tests on Linux and Windows for every push. To release,
bump the version and push a matching tag; the release workflow tests, builds every
package and publishes them:

```sh
npm version 0.6.0 --no-git-tag-version
git commit -am "Release 0.6.0"
git tag -a v0.6.0 -m "MyST Editor 0.6.0"
git push origin master v0.6.0
```
