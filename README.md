# mysteditor

A WYSIWYG editor for Sphinx + MyST Markdown, aimed at writers who shouldn't have to
see Markdown syntax. Planned as an Electron app shipped as an AppImage.

## Status: phase 1 — round-trip spike

The riskiest part of the project is turning `.md` files into an editable document and
back without rewriting the parts the writer didn't touch. Phase 1 proves that out,
with no UI yet:

```
.md ──myst-parser──▶ mdast ──▶ ProseMirror doc ──(edits)──▶ serializer ──▶ .md
                        └── source map: exact original text of every block ──┘
```

- `src/parse.ts` uses myst-parser (from mystmd) for block structure and line ranges.
  It cuts each container (document, directive body, list item, blockquote) into
  segments at block boundaries and records each block's exact source text. Nested
  containers are re-parsed from their inner text.
- `src/serialize.ts` writes any block still equal to its original back verbatim,
  along with the original whitespace between untouched neighbours. Edited blocks are
  serialized fresh, keeping the original fence style, directive header, list marker
  and padding, and emphasis style.
- `src/directive.ts` splits directives into header, options and body itself. The
  parser only separates options for directives it has a spec for.
- `src/schema.ts`: directives with a Markdown body (admonitions, figure, dropdown,
  tabs, grids, …) are editable blocks. Code-like directives are editable code. Any
  directive the editor doesn't know is an opaque block kept byte-for-byte.

## Results

Test corpus: 176 real documentation files from MyST-Parser, MyST-NB, sphinx-design,
sphinx-book-theme, sphinx-exercise and the-littlest-jupyterhub, plus `corpus/`.

| Check | Result |
|---|---|
| Unedited files round-trip byte-for-byte | 176/176 (100%) |
| Serializing everything from scratch re-parses to the same document | 175/176 (99.4%) |
| Typing one character into a paragraph/heading changes exactly one line | 3996/4019 (99.4%) |
| …and the result re-parses to the edited document | 4019/4019 (100%) |
| Blocks shown as raw/opaque rather than rich | 7.3% |
| Parse time | ~8 ms/file average, ~200 ms for a 2,000-line changelog |

The remaining 0.6% of edits produce correct output but touch neighbouring lines in
the same paragraph, because the parse tree doesn't record some source spellings:

- needless escapes like `\'` are dropped
- `[x](<url>)` becomes `[x](url)`
- literal `[brackets]` get escaped
- a document mixing `*em*` and `_em_` gets the dominant style

## Run it

```sh
npm install
npm test                                  # corpus round-trip + simulated edits
npm run typecheck
npm run roundtrip -- <docs-dir>...        # report over real files
FUZZ_MARKS=1 VERBOSE=1 npm run roundtrip -- <dir>   # fuzz inside formatted text too, show all failures
npx tsx scripts/debug-file.ts <file.md>   # first block that doesn't round-trip, and why
npx tsx scripts/structure.ts <file.md>    # block tree as the editor sees it
```

## Known limitations / follow-ups

- **Parser dialect vs. the project's `conf.py`.** Sphinx's MyST-Parser makes
  `colon_fence`, `dollarmath`, `deflist`, `tasklist`, `substitution` etc. opt-in via
  `myst_enable_extensions`; mystmd's parser enables most of them by default. The
  parser config should be read from each project's `conf.py`. mystmd's `@citation`
  syntax is already disabled because Sphinx doesn't have it.
- Still raw for now: GFM tables, `list-table`, definition lists, footnote definitions,
  `{image}`, `{toctree}`, front matter. They're preserved exactly, just not
  rich-editable yet.
- Preservation works at block level. Editing one word re-serializes that paragraph,
  which is why soft line breaks are kept as nodes, so the paragraph's wrapping stays.
- `npm audit` reports DoS-class advisories in markdown-it 13 / linkify-it 4, which
  myst-parser pins. Low risk for a local editor opening the user's own files (the
  affected linkify/smartquotes paths are disabled); revisit when myst-parser updates.

## Roadmap

1. ~~Round-trip spike~~ ✅
2. MVP: Electron shell, open a project folder, page tree, ProseMirror editor with node
   views for directives/roles/math, source-mode toggle, save, AppImage via
   electron-builder.
3. Sphinx integration: bundled `uv` manages a per-project Python environment from the
   project's requirements; background builds; real preview; cross-reference
   autocomplete; Sphinx warnings shown inline.
4. Custom extensions: Sphinx-rendered previews of unknown directives, and per-project
   option forms.
