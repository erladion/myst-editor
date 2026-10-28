// AsciiDoc pages: read and written back exactly, written anew so that they read the
// same, and read into the blocks Asciidoctor finds.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Fragment, Node as PMNode, Slice } from 'prosemirror-model';
import { diffLines } from 'diff';
import { load } from '@asciidoctor/core';
import { parseAsciidoc } from '../src/core/asciidoc/parse.js';
import { serializeAsciidoc } from '../src/core/asciidoc/serialize.js';
import { semanticForm } from '../src/core/document.js';

const dir = join(import.meta.dirname, '..', 'corpus', 'asciidoc');
// Asciidoctor counts lines without the preprocessor's (ifdef::...), so pages with
// them are left out of comparing lines.
const PREPROCESSED = new Set(['conditions.adoc']);
const corpus = readdirSync(dir)
  .filter((f) => f.endsWith('.adoc'))
  .map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const);

describe.each(corpus)('%s', (_name, src) => {
  it('round-trips byte for byte when unedited', () => {
    const { doc, map } = parseAsciidoc(src);
    expect(serializeAsciidoc(doc, map)).toBe(src);
  });

  it('round-trips after the document is rebuilt from JSON', () => {
    const { doc, map } = parseAsciidoc(src);
    expect(serializeAsciidoc(PMNode.fromJSON(doc.type.schema, doc.toJSON()), map)).toBe(src);
  });

  it('written anew, reads back the same', () => {
    const { doc, map } = parseAsciidoc(src);
    const fresh = serializeAsciidoc(doc, map, { fresh: true });
    expect(semanticForm(parseAsciidoc(fresh).doc)).toEqual(semanticForm(doc));
  });

  it('produces a valid document', () => {
    expect(() => parseAsciidoc(src).doc.check()).not.toThrow();
  });

  it.skipIf(PREPROCESSED.has(_name))('finds the blocks Asciidoctor does, where it does', async () => {
    // Asciidoctor's top-level blocks (sections opened up), by their first line.
    const asciidoctor: string[] = [];
    const walk = (block: { getBlocks(): unknown[] }) => {
      for (const b of block.getBlocks() as { getContext(): string; getLineNumber(): number; getBlocks(): unknown[] }[]) {
        if (b.getContext() === 'section' || b.getContext() === 'preamble') {
          if (b.getContext() === 'section') asciidoctor.push(`heading@${b.getLineNumber()}`);
          walk(b);
        } else asciidoctor.push(`${b.getContext()}@${b.getLineNumber()}`);
      }
    };
    walk((await load(src, { sourcemap: true, safe: 'safe' })) as unknown as { getBlocks(): unknown[] });
    const { doc, map } = parseAsciidoc(src);
    const ours: string[] = [];
    // Lines of blocks kept as written, which may be anything to Asciidoctor.
    const asWritten = new Set<number>();
    doc.forEach((n, _o, i) => {
      const entry = map.get(n.attrs.sid)!;
      // The document title isn't a section.
      if (i === 0 && n.type.name === 'heading' && n.attrs.level === 1) return;
      if ((n.type.name === 'raw_block' && n.attrs.kind === 'asciidoc') || n.type.name === 'opaque_directive') {
        entry.text.split('\n').forEach((_l, k) => asWritten.add(entry.line + k));
        return;
      }
      const name = n.type.name === 'raw_block' ? `raw:${n.attrs.kind}` : n.type.name === 'md_directive' ? `md:${n.attrs.name}` : n.type.name;
      const kind = n.type.name === 'code_block' && (n.attrs.name === 'literal' || n.attrs.indented) ? 'literal' : CONTEXTS[name];
      if (kind) ours.push(`${kind}@${entry.line + delimiterOffset(n, entry.text)}`);
    });
    // Ours, mapped to Asciidoctor's names, for the kinds of blocks both have.
    const kinds = new Set(ours.map((o) => o.split('@')[0]));
    expect(ours).toEqual(asciidoctor.filter((a) => kinds.has(a.split('@')[0]) && !asWritten.has(Number(a.split('@')[1]))));
  });
});

// Asciidoctor's names for the editor's blocks (those it reports as blocks).
const CONTEXTS: Record<string, string> = {
  heading: 'heading',
  paragraph: 'paragraph',
  bullet_list: 'ulist',
  ordered_list: 'olist',
  code_block: 'listing',
  'md:note': 'admonition',
  'md:tip': 'admonition',
  'md:warning': 'admonition',
  'md:caution': 'admonition',
  'md:important': 'admonition',
  'md:sidebar': 'sidebar',
  'md:example': 'example',
  'md:quote': 'quote',
  blockquote: 'quote',
  thematic_break: 'thematic_break',
  'raw:table': 'table',
};

// Asciidoctor gives a block's line as the first after its header (attribute lines,
// title), which for a delimited block is its delimiter's.
function delimiterOffset(node: PMNode, text: string): number {
  if (node.type.name === 'heading') return 0;
  const lines = text.split('\n');
  let k = 0;
  while (k < lines.length - 1 && (/^\[.*\]\s*$/.test(lines[k]) || /^\.[^\s.]/.test(lines[k]))) k++;
  return k;
}

describe.each(corpus)('%s, edited', (_name, src) => {
  it('changes only the lines of the block typed in, and reads back as edited', () => {
    const { doc } = parseAsciidoc(src);
    const places: number[] = [];
    doc.descendants((n, pos) => {
      if (n.isTextblock && n.type.name !== 'code_block' && n.type.name !== 'math_block' && n.content.size) places.push(pos + n.nodeSize - 1);
      return true;
    });
    expect(places.length).toBeGreaterThan(3);
    for (const at of places) {
      const { doc, map } = parseAsciidoc(src);
      const edited = doc.replace(at, at, new Slice(Fragment.from(doc.type.schema.text('X')), 0, 0));
      const out = serializeAsciidoc(edited, map);
      expect(semanticForm(parseAsciidoc(out).doc), `typing at ${at}:\n${out}`).toEqual(semanticForm(edited));
      const changed = diffLines(src, out).filter((p) => p.added || p.removed);
      const removed = changed.filter((p) => p.removed).reduce((n, p) => n + (p.count ?? 0), 0);
      expect(removed, `typing at ${at}:\n${changed.map((p) => (p.added ? '+' : '-') + p.value).join('')}`).toBeLessThanOrEqual(1);
    }
  });
});
