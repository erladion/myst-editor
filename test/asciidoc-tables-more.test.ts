// AsciiDoc tables of other kinds: between longer or ! fences (in a cell), with cells
// of 2*, a footer, and tables of values (comma-, delimiter- or tab-separated).
import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { addRowAfter } from 'prosemirror-tables';
import { loadDocument, saveDocument } from '../src/core/document.js';
import { ASCIIDOC_CONFIG } from '../src/core/asciidoc/config.js';
import { schema } from '../src/core/schema.js';

const load = (text: string) => loadDocument(text, ASCIIDOC_CONFIG);
const table = (text: string) => {
  let t: PMNode | null = null;
  load(text).doc.descendants((n) => {
    if (!t && n.type.name === 'table') t = n;
    return !t;
  });
  return t as PMNode | null;
};
const rows = (t: PMNode) => {
  const out: string[][] = [];
  t.forEach((r) => {
    const cells: string[] = [];
    r.forEach((c) => void cells.push(c.textContent));
    out.push(cells);
  });
  return out;
};

// `text` with `typed` typed at the end of the cell reading `cell`: saved, verified.
function typedIn(text: string, cell: string, typed: string, nth = 0): string {
  const { doc, map } = load(text);
  let at = -1;
  let seen = 0;
  doc.descendants((n, pos) => {
    if (at < 0 && (n.type.name === 'table_cell' || n.type.name === 'table_header') && n.textContent === cell && seen++ === nth) at = pos + n.nodeSize - 2;
    return at < 0;
  });
  // (In a cell of blocks: inside its last paragraph.)
  let $end = doc.resolve(at);
  while (!$end.parent.isTextblock) $end = doc.resolve($end.pos - 1);
  const tr = EditorState.create({ doc, schema }).tr.insertText(typed, $end.pos);
  const saved = saveDocument(tr.doc, map, ASCIIDOC_CONFIG);
  expect(saved.problem).toBeUndefined();
  return saved.text;
}

describe('a table between other fences', () => {
  it('of four =, written with them', () => {
    const page = '|====\n|a |b\n|c |d\n|====\n';
    expect(rows(table(page)!)).toEqual([['a', 'b'], ['c', 'd']]);
    expect(saveDocument(load(page).doc, load(page).map, ASCIIDOC_CONFIG).text).toBe(page);
    expect(typedIn(page, 'd', '!')).toBe(page.replace('|d', '|d!'));
  });

  it('in a cell of blocks: !===, its cells between !', () => {
    const page = '[cols="1,2a"]\n|===\n|Outer\n|Text.\n\n!===\n! Inner ! cell\n! x\\!y ! z\n!===\n|===\n';
    const outer = table(page)!;
    let inner: PMNode | null = null;
    outer.descendants((n) => {
      if (!inner && n.type.name === 'table') inner = n;
      return !inner;
    });
    expect(inner).not.toBeNull();
    expect(rows(inner!)).toEqual([['Inner', 'cell'], ['x!y', 'z']]);
    expect(inner!.attrs.fence).toBe('!===');
    const { doc, map } = load(page);
    expect(saveDocument(doc, map, ASCIIDOC_CONFIG).text).toBe(page);
    expect(typedIn(page, 'z', '!')).toBe(page.replace('! z', '! z\\!'));
  });
});

describe('cells of 2*', () => {
  const page = '|===\n|A |B |C\n\n2*|Same |Other\n|1 |2 |3\n|===\n';
  it('are as many cells, the same', () => {
    expect(rows(table(page)!)).toEqual([['A', 'B', 'C'], ['Same', 'Same', 'Other'], ['1', '2', '3']]);
    const { doc, map } = load(page);
    expect(saveDocument(doc, map, ASCIIDOC_CONFIG).text).toBe(page);
  });

  it('one again while they’re alike; apart once one is edited', () => {
    expect(typedIn(page, 'Other', '!')).toBe(page.replace('2*|Same |Other', '2*|Same |Other!'));
    expect(typedIn(page, 'Same', '!', 1)).toBe(page.replace('2*|Same |Other', '|Same |Same! |Other'));
    const over = '[cols=3]\n|===\n2*|One\ntwo\n|x\n|===\n';
    expect(typedIn(over, 'x', '!')).toBe(over.replace('|x', '|x!'));
  });

  it('going on into the next row: as written', () => {
    expect(table('[cols=2]\n|===\n|a\n3*|b\n|===\n')).toBeNull();
  });

  it('take the lines going on, each', () => {
    const [cells] = rows(table('[cols=3]\n|===\n3*|One\ntwo\n|===\n')!);
    expect(cells).toHaveLength(3);
    for (const c of cells) expect(c).toMatch(/^One\s*two$/);
  });
});

describe('a table with a footer', () => {
  it('is a table, its option kept', () => {
    const page = '[%footer]\n|===\n|a |b\n|c |d\n|===\n';
    expect(table(page)?.attrs.header).toBe('[%footer]');
  });
});

describe('a table of values', () => {
  it('comma-separated: a row a line, quoted values as written', () => {
    const page = ',===\nArtist,Track\n\nBaauer,"Harlem Shake, remix"\n"The ""Band""",Ho Hey\n,===\n';
    const t = table(page)!;
    expect(rows(t)).toEqual([['Artist', 'Track'], ['Baauer', 'Harlem Shake, remix'], ['The "Band"', 'Ho Hey']]);
    expect(t.firstChild!.firstChild!.type.name).toBe('table_header');
    const { doc, map } = load(page);
    expect(saveDocument(doc, map, ASCIIDOC_CONFIG).text).toBe(page);
    // Edited, a value quoted where it must be; the others as written.
    expect(typedIn(page, 'Ho Hey', ', live')).toBe(page.replace(',Ho Hey', ',"Ho Hey, live"'));
    expect(typedIn(page, 'Track', 's')).toBe(page.replace('Artist,Track', 'Artist,Tracks'));
  });

  it('delimiter-separated, and in a |=== table by its format', () => {
    const dsv = ':===\nA:B\nx\\:y:z\n:===\n';
    expect(rows(table(dsv)!)).toEqual([['A', 'B'], ['x:y', 'z']]);
    expect(typedIn(dsv, 'z', ':w')).toBe(dsv.replace('x\\:y:z', 'x\\:y:z\\:w'));
    const csv = '[%header,format=csv]\n|===\nArtist,Track\nBaauer,Harlem Shake\n|===\n';
    expect(rows(table(csv)!)).toEqual([['Artist', 'Track'], ['Baauer', 'Harlem Shake']]);
    expect(typedIn(csv, 'Harlem Shake', '!')).toBe(csv.replace('Harlem Shake', 'Harlem Shake!'));
  });

  it('a new row: a line of values', () => {
    const page = ',===\na,b\nc,d\n,===\n';
    const { doc, map } = load(page);
    let state = EditorState.create({ doc, schema });
    let at = -1;
    doc.descendants((n, pos) => {
      if (at < 0 && n.isTextblock && n.textContent === 'd') at = pos + 1;
      return at < 0;
    });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
    addRowAfter(state, (tr) => (state = state.apply(tr)));
    expect(saveDocument(state.doc, map, ASCIIDOC_CONFIG).text).toBe(',===\na,b\nc,d\n,\n,===\n');
  });

  it('with a value over lines, or a row short of values: as written', () => {
    expect(table(',===\na,"b\nc"\n,===\n')).toBeNull();
    expect(table(',===\na,b\nc\n,===\n')).toBeNull();
  });
});
