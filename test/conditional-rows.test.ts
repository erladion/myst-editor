// Table rows between condition markers: one table, each row knowing its conditions.
import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { loadDocument, saveDocument } from '../src/core/document.js';
import { DEFAULT_CONFIG, type MystConfig } from '../src/core/project-config.js';
import { loadEditorConfig } from '../src/core/editor-config.js';

const editor = loadEditorConfig([{ file: '.mysteditor.toml', text: '[conditions]\ncapabilities = "c.json"\n', readCapabilities: () => '["CapabilityX", "CapabilityY"]' }]);
const config: MystConfig = { ...DEFAULT_CONFIG, editor };

const TABLE = `| Plan       | Price  |
|------------|--------|
| Basic      | Free   |
<!-- if: CapabilityX -->
| Pro        | $10    |
| Team       | $50    |
<!-- if: CapabilityY -->
| Enterprise | Ask us |
<!-- endif -->
<!-- endif -->
| Community  | Free   |
`;

const rows = (doc: PMNode) => {
  const out: [string, string[]][] = [];
  doc.firstChild!.forEach((row) => out.push([row.firstChild!.textContent, row.attrs.conds.map((c: { start: string }) => c.start)]));
  return out;
};

// Replace the text of the first cell whose text is `from`.
function editCell(doc: PMNode, from: string, to: string) {
  const state = EditorState.create({ doc });
  let at = -1;
  doc.descendants((n, pos) => {
    if (at < 0 && n.isText && n.text === from) at = pos;
  });
  return state.apply(state.tr.insertText(to, at, at + from.length)).doc;
}

describe('table rows in conditions', () => {
  it('are one table, each row with its conditions, and saved as they were', () => {
    const { doc, map } = loadDocument(TABLE, config);
    expect(doc.childCount).toBe(1);
    expect(rows(doc)).toEqual([
      ['Plan', []],
      ['Basic', []],
      ['Pro', ['<!-- if: CapabilityX -->']],
      ['Team', ['<!-- if: CapabilityX -->']],
      ['Enterprise', ['<!-- if: CapabilityX -->', '<!-- if: CapabilityY -->']],
      ['Community', []],
    ]);
    expect(saveDocument(doc, map, config)).toEqual({ text: TABLE, verified: true });
  });

  it('keep their markers when the table is edited', () => {
    const { doc, map } = loadDocument(TABLE, config);
    const r = saveDocument(editCell(doc, 'Basic', 'Starter'), map, config);
    expect(r.verified).toBe(true);
    expect(r.text).toBe(TABLE.replace('| Basic      |', '| Starter    |'));
  });

  it('stay in their group when the group’s first row is deleted', () => {
    const { doc, map } = loadDocument(TABLE, config);
    const state = EditorState.create({ doc });
    let pro = -1;
    doc.firstChild!.forEach((row, offset) => {
      if (row.firstChild!.textContent === 'Pro') pro = 1 + offset;
    });
    const next = state.apply(state.tr.delete(pro, pro + doc.firstChild!.child(2).nodeSize)).doc;
    const r = saveDocument(next, map, config);
    expect(r.verified).toBe(true);
    expect(r.text).toBe(TABLE.replace('<!-- if: CapabilityX -->\n| Pro        | $10    |\n', '<!-- if: CapabilityX -->\n'));
  });

  it('are left as they are when they aren’t clearly the table’s', () => {
    const cases = [
      ['a blank line before the marker', '| A | B |\n|---|---|\n| 1 | 2 |\n\n<!-- if: CapabilityX -->\n| 3 | 4 |\n<!-- endif -->\n'],
      ['a row with another number of cells', '| A | B |\n|---|---|\n<!-- if: CapabilityX -->\n| 3 | 4 | 5 |\n<!-- endif -->\n'],
      ['a condition that doesn’t end', '| A | B |\n|---|---|\n<!-- if: CapabilityX -->\n| 3 | 4 |\n'],
    ];
    for (const [what, src] of cases) {
      const { doc, map } = loadDocument(src, config);
      expect(doc.childCount, what).toBeGreaterThan(1);
      expect(saveDocument(doc, map, config).text, what).toBe(src);
    }
    // Without conditions in the settings, markers are only comments.
    expect(loadDocument(TABLE).doc.childCount).toBeGreaterThan(1);
  });
});
