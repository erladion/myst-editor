// Link definitions ([name]: url): a card of their own, edited in a form.
import { describe, expect, it } from 'vitest';
import { loadDocument, saveDocument } from '../src/core/document.js';
import { DEFAULT_CONFIG } from '../src/core/project-config.js';
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
});
