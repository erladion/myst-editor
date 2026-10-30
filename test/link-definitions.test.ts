// Link definitions ([name]: url): a card of their own, edited in a form.
import { describe, expect, it } from 'vitest';
import { loadDocument, saveDocument } from '../src/core/document.js';
import { DEFAULT_CONFIG } from '../src/core/project-config.js';
import { Slice } from 'prosemirror-model';
import { Transform } from 'prosemirror-transform';
import { definitionsForm } from '../src/renderer/src/formats/myst/definitions.js';

const PAGE = 'See [the guide][guide] and [PyPI].\n\n[guide]: https://example.com/guide "The guide"\n[PyPI]:   <https://pypi.org/project/x y>\n';

describe('link definitions', () => {
  it('are a block of their own, written as they were; the links still go to them', () => {
    const { doc, map } = loadDocument(PAGE, DEFAULT_CONFIG);
    expect(doc.lastChild!.attrs).toMatchObject({ kind: 'definitions', source: '[guide]: https://example.com/guide "The guide"\n[PyPI]:   <https://pypi.org/project/x y>' });
    const hrefs: string[] = [];
    doc.descendants((n) => void n.marks.forEach((m) => m.type.name === 'link' && hrefs.push(m.attrs.href)));
    expect(hrefs).toEqual(['https://example.com/guide', 'https://pypi.org/project/x%20y']);
    expect(saveDocument(doc, map, DEFAULT_CONFIG).text).toBe(PAGE);
  });

  it('end where the text after them starts; other lines no block owns stay as they were', () => {
    const { doc } = loadDocument('Text.\n\n[a]: b\nnot one\n', DEFAULT_CONFIG);
    expect([...Array(doc.childCount).keys()].map((i) => doc.child(i).attrs.kind ?? doc.child(i).type.name)).toEqual(['paragraph', 'definitions', 'paragraph']);
    expect(loadDocument('[^a]: footnote\n', { ...DEFAULT_CONFIG, extensions: [] }).doc.firstChild!.attrs.kind).not.toBe('definitions');
  });

  it('are edited in a form: an address changed keeps its title; one more, or one less', () => {
    const form = definitionsForm('[guide]: https://example.com/guide "The guide"\n[PyPI]:   <https://pypi.org/project/x y>')!;
    expect(form.fields.map((f) => [f.label, f.value])).toEqual([
      ['[guide]', 'https://example.com/guide'],
      ['[PyPI]', 'https://pypi.org/project/x y'],
      ['Another link target', ''],
    ]);
    const v = (patch: Record<string, string>) => form.source({ d0: 'https://example.com/guide', d1: 'https://pypi.org/project/x y', new: '', ...patch });
    expect(v({})).toBe('[guide]: https://example.com/guide "The guide"\n[PyPI]:   <https://pypi.org/project/x y>');
    expect(v({ d0: 'https://example.org/' })).toBe('[guide]: https://example.org/ "The guide"\n[PyPI]:   <https://pypi.org/project/x y>');
    expect(v({ d1: 'https://pypi.org/project/a b' })).toBe('[guide]: https://example.com/guide "The guide"\n[PyPI]: <https://pypi.org/project/a b>');
    expect(v({ d0: '', new: 'docs: https://docs.example.com' })).toBe('[PyPI]:   <https://pypi.org/project/x y>\n[docs]: https://docs.example.com');
  });

  // The block replaced by another source, the links to `from` going to `to`.
  function replaced(page: string, source: string, from: string, to: string) {
    const { doc, map } = loadDocument(page, DEFAULT_CONFIG);
    const loaded = loadDocument(source, DEFAULT_CONFIG);
    map.merge(loaded.map);
    let at = 0;
    doc.forEach((n, p) => void (n.attrs.kind === 'definitions' && (at = p)));
    const tr = new Transform(doc).replaceWith(at, at + doc.nodeAt(at)!.nodeSize, loaded.doc.content);
    tr.doc.descendants((n, p) => {
      const link = n.marks.find((m) => m.attrs.href === from);
      if (link) tr.removeMark(p, p + n.nodeSize, link).addMark(p, p + n.nodeSize, link.type.create({ ...link.attrs, href: to }));
    });
    return saveDocument(tr.doc, map, DEFAULT_CONFIG);
  }

  it('changed, the links go to the new address and are written as they were', () => {
    const page = 'See [the guide][guide].\n\n[guide]: https://example.com/guide\n';
    expect(replaced(page, '[guide]: https://example.org/\n', 'https://example.com/guide', 'https://example.org/')).toEqual({ text: page.replace('https://example.com/guide', 'https://example.org/'), verified: true });
  });

  it('taken out, the links to it are written with their address', () => {
    const page = 'See [the guide][guide].\n\n[guide]: https://example.com/guide "Guide"\n\nMore.\n';
    const { doc, map } = loadDocument(page, DEFAULT_CONFIG);
    let at = 0;
    doc.forEach((n, p) => void (n.attrs.kind === 'definitions' && (at = p)));
    const next = doc.replace(at, at + doc.nodeAt(at)!.nodeSize, Slice.empty);
    // The paragraph, edited elsewhere, is written anew.
    const typed = next.replace(next.firstChild!.nodeSize - 1, next.firstChild!.nodeSize - 1, new Slice(next.type.schema.nodes.paragraph.create(null, next.type.schema.text('!')).content, 0, 0));
    expect(saveDocument(typed, map, DEFAULT_CONFIG)).toEqual({ text: 'See [the guide](https://example.com/guide "Guide").!\n\nMore.\n', verified: true });
  });
});
