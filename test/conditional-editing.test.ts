// Conditional content and declared directives, through parse → edit → save.
import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { loadDocument, saveDocument } from '../src/core/document.js';
import { DEFAULT_CONFIG, type MystConfig } from '../src/core/project-config.js';
import { loadEditorConfig } from '../src/core/editor-config.js';
import { conditionKind, makeConditional, removeCondition, scanConditions } from '../src/renderer/src/editor/conditions.js';

const settingsToml = `
[directives.company-callout]
label = "Internal note"
[directives.company-callout.options.audience]
choices = ["internal", "public"]

[directives.diagram]
body = "text"

[conditions]
capabilities = "caps.json"
`;
const editor = loadEditorConfig([{ file: '.mysteditor.toml', text: settingsToml, readCapabilities: () => '["CapabilityX", "CapabilityY", "CapabilityZ"]' }]);
const config: MystConfig = { ...DEFAULT_CONFIG, editor };
const settings = editor.conditions!;

const doc = `# Setup

Everyone sees this.

<!-- if: CapabilityX or CapabilityY -->
Only for X or Y.

<!-- if: CapabilityZ -->
Nested for Z.
<!-- endif -->
<!-- endif -->

The <!-- if-inline: CapabilityX -->fast<!-- endif-inline --> path.

- One
- Two
`;

function load(src = doc) {
  const { doc: pm, map } = loadDocument(src, config);
  return { state: EditorState.create({ doc: pm }), map };
}

function textPos(d: PMNode, text: string, end = false): number {
  let found = -1;
  d.descendants((n, pos) => {
    if (found >= 0) return false;
    if (n.isText && n.text!.includes(text)) found = pos + n.text!.indexOf(text) + (end ? text.length : 0);
  });
  return found;
}

describe('parsing', () => {
  it('classifies condition markers and declared directives', () => {
    const { state } = load(`${doc}\n:::{company-callout}\n:audience: internal\n\nHello\n:::\n\n\`\`\`{diagram}\nA -> B\n\`\`\`\n`);
    const kinds: string[] = [];
    state.doc.descendants((n) => {
      if (n.type.name === 'raw_block') kinds.push(n.attrs.kind);
      if (n.type.name === 'md_directive' || (n.type.name === 'code_block' && n.attrs.directive)) kinds.push(`${n.type.name}:${n.attrs.name}`);
    });
    expect(kinds).toEqual(['condition-start', 'condition-start', 'condition-end', 'condition-end', 'md_directive:company-callout', 'code_block:diagram']);
  });

  it('pairs markers by nesting, inline ones within their paragraph', () => {
    const { state } = load();
    const { regions, unmatched } = scanConditions(state.doc, settings);
    expect(regions.map((r) => [r.start.expr, r.depth, r.start.inline])).toEqual([
      ['CapabilityZ', 2, false],
      ['CapabilityX or CapabilityY', 1, false],
      ['CapabilityX', 1, true],
    ]);
    expect(unmatched).toEqual([]);
  });

  it('reports markers without a partner', () => {
    const { state } = load('<!-- if: X -->\nText\n\n<!-- endif -->\n\n<!-- endif -->\n');
    const { regions, unmatched } = scanConditions(state.doc, settings);
    expect(regions).toHaveLength(1);
    expect(unmatched.map((m) => m.kind)).toEqual(['end']);
  });

  it('round-trips a document with conditions byte-for-byte', () => {
    const { state, map } = load();
    expect(saveDocument(state.doc, map, config)).toEqual({ text: doc, verified: true });
  });

  it('keeps a table using a custom role such as {colspan} exactly as written', () => {
    const table = '| A | B |\n|---|---|\n| {colspan}`2` Wide cell | |\n';
    const { state, map } = load(table);
    expect(state.doc.firstChild!.type.name).toBe('table');
    expect(saveDocument(state.doc, map, config).text).toBe(table);
  });
});

describe('making content conditional', () => {
  it('wraps the current block in block markers', () => {
    const { state, map } = load();
    const at = textPos(state.doc, 'Everyone');
    const s = state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
    expect(conditionKind(s, settings)).toEqual({ inline: false });
    let next = s;
    makeConditional(settings, 'CapabilityY')(s, (tr) => (next = s.apply(tr)));
    const r = saveDocument(next.doc, map, config);
    expect(r.verified).toBe(true);
    expect(r.text).toContain('# Setup\n\n<!-- if: CapabilityY -->\n\nEveryone sees this.\n\n<!-- endif -->\n\n<!-- if: CapabilityX or CapabilityY -->');
  });

  it('wraps selected words in inline markers', () => {
    const { state, map } = load();
    const from = textPos(state.doc, 'sees');
    const s = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, from + 4)));
    expect(conditionKind(s, settings)).toEqual({ inline: true, ok: true });
    let next = s;
    makeConditional(settings, 'CapabilityZ')(s, (tr) => (next = s.apply(tr)));
    const r = saveDocument(next.doc, map, config);
    expect(r.verified).toBe(true);
    expect(r.text).toContain('Everyone <!-- if-inline: CapabilityZ -->sees<!-- endif-inline --> this.');
  });

  it('leaves spaces at the edges of the selection outside the condition', () => {
    const { state, map } = load();
    const from = textPos(state.doc, 'sees');
    // "sees " as Windows selects a double-clicked word.
    const s = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, from + 5)));
    let next = s;
    makeConditional(settings, 'CapabilityZ')(s, (tr) => (next = s.apply(tr)));
    expect(saveDocument(next.doc, map, config).text).toContain('Everyone <!-- if-inline: CapabilityZ -->sees<!-- endif-inline --> this.');
  });

  it('refuses an inline condition at the start of a line, which would read as an HTML block', () => {
    const { state } = load();
    const from = textPos(state.doc, 'Everyone');
    const s = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, from + 8)));
    expect(conditionKind(s, settings)).toMatchObject({ inline: true, ok: false });
    expect(makeConditional(settings, 'X')(s)).toBe(false);
  });

  it('keeps a tight list tight when an item becomes conditional', () => {
    const { state, map } = load();
    const at = textPos(state.doc, 'Two');
    const s = state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
    let next = s;
    makeConditional(settings, 'CapabilityX')(s, (tr) => (next = s.apply(tr)));
    const r = saveDocument(next.doc, map, config);
    expect(r.verified).toBe(true);
    expect(r.text.endsWith('- One\n- <!-- if: CapabilityX -->\n  Two\n  <!-- endif -->\n')).toBe(true);
  });
});

describe('removing a condition', () => {
  it('removes both markers and keeps the content', () => {
    const { state, map } = load();
    const { regions } = scanConditions(state.doc, settings);
    const outer = regions.find((r) => r.depth === 1 && !r.start.inline)!;
    let next = state;
    removeCondition(settings, outer.start.pos)(state, (tr) => (next = state.apply(tr)));
    const r = saveDocument(next.doc, map, config);
    expect(r.verified).toBe(true);
    expect(r.text).toContain('Everyone sees this.\n\nOnly for X or Y.\n\n<!-- if: CapabilityZ -->\nNested for Z.\n<!-- endif -->\n\nThe');
  });

  it('removes an inline pair from its end marker too', () => {
    const { state, map } = load();
    const inline = scanConditions(state.doc, settings).regions.find((r) => r.start.inline)!;
    let next = state;
    removeCondition(settings, inline.end.pos)(state, (tr) => (next = state.apply(tr)));
    expect(saveDocument(next.doc, map, config).text).toContain('The fast path.');
  });
});
