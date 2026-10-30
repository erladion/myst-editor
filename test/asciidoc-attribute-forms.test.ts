// AsciiDoc's attribute entries and blocks' attribute lines, edited in forms: what a
// form changes written anew, the rest as it was.
import { describe, expect, it } from 'vitest';
import { blockAttributesForm, entriesForm } from '../src/renderer/src/formats/asciidoc/attributes.js';
import type { CardForm } from '../src/renderer/src/formats/editing.js';

const valuesOf = (form: CardForm, patch: Record<string, string | undefined>) => {
  const v: Record<string, string> = Object.fromEntries(form.fields.map((f) => [f.key, f.value]));
  for (const [k, x] of Object.entries(patch)) {
    if (x === undefined) delete v[k];
    else v[k] = x;
  }
  return form.source(v);
};

const HEADER = 'Doc Writer <doc@example.com>\nv1.0, 2026-01-01\n// Settings:\n:toc:\n:description: A long \\\n  description\n:icons!:\nifdef::env-github[]\n:tip-caption: :bulb:\nendif::[]';

describe('a document header', () => {
  const form = entriesForm(HEADER, true)!;
  it('has its author, revision and attributes, a value over lines in a box of lines', () => {
    expect(form.fields.map((f) => [f.label, f.value])).toEqual([
      ['Author', 'Doc Writer <doc@example.com>'],
      ['Revision', 'v1.0, 2026-01-01'],
      ['toc', ''],
      ['description', 'A long\ndescription'],
      ['tip-caption', ':bulb:'],
      ['Another attribute', ''],
    ]);
    expect(form.fields.find((f) => f.label === 'description')!.lines).toBeGreaterThan(1);
    expect(form.fields.find((f) => f.label === 'toc')!.removable).toBe(true);
  });

  it('writes back what it was given unchanged as it was', () => {
    expect(valuesOf(form, {})).toBe(HEADER);
  });

  it('changes, removes and adds attributes among the rest', () => {
    expect(valuesOf(form, { l3: 'left' })).toBe(HEADER.replace(':toc:', ':toc: left'));
    expect(valuesOf(form, { l3: undefined })).toBe(HEADER.replace(':toc:\n', ''));
    expect(valuesOf(form, { l4: 'Short' })).toBe(HEADER.replace(':description: A long \\\n  description', ':description: Short'));
    expect(valuesOf(form, { l4: 'Two\nlines' })).toBe(HEADER.replace(':description: A long \\\n  description', ':description: Two \\\nlines'));
    expect(valuesOf(form, { new: 'sectnums' })).toBe(HEADER.replace(':tip-caption: :bulb:', ':tip-caption: :bulb:\n:sectnums:'));
    expect(valuesOf(form, { new: 'experimental: true' })).toContain(':experimental: true');
  });

  it('changes the author and revision lines', () => {
    expect(valuesOf(form, { l0: 'Another Writer' })).toBe(HEADER.replace('Doc Writer <doc@example.com>', 'Another Writer'));
    expect(valuesOf(form, { l1: '' })).toBe(HEADER.replace('v1.0, 2026-01-01\n', ''));
    // The author under a revision line: kept, or that line would be the author's.
    expect(valuesOf(form, { l0: '' })).toBe(HEADER);
  });

  it('elsewhere, entries are entries: no author line', () => {
    const f = entriesForm(':a: 1\n:b:', false)!;
    expect(f.fields.map((x) => x.label)).toEqual(['a', 'b', 'Another attribute']);
    expect(entriesForm('Just text', false)!.fields.map((x) => x.label)).toEqual(['Another attribute']);
  });
});

describe('a block’s attribute lines', () => {
  it('has its title, style, id, roles, options and the rest', () => {
    const form = blockAttributesForm('.Parts of an atom\n[square#atoms.lead%interactive,start=4]')!;
    expect(form.fields.map((f) => [f.key, f.value])).toEqual([
      ['title', 'Parts of an atom'],
      ['style', 'square'],
      ['id', 'atoms'],
      ['roles', 'lead'],
      ['opts', 'interactive'],
      ['rest', 'start=4'],
    ]);
    expect(valuesOf(form, {})).toBe('.Parts of an atom\n[square#atoms.lead%interactive,start=4]');
    expect(valuesOf(form, { title: 'Atoms' })).toBe('.Atoms\n[square#atoms.lead%interactive,start=4]');
    expect(valuesOf(form, { id: 'parts', roles: 'lead big' })).toBe('.Parts of an atom\n[square#parts.lead.big%interactive,start=4]');
    expect(valuesOf(form, { title: '' })).toBe('[square#atoms.lead%interactive,start=4]');
    expect(valuesOf(form, { style: '', id: '', roles: '', opts: '', rest: '' })).toBe('.Parts of an atom');
  });

  it('adds a title, first; keeps an empty list as it was', () => {
    const form = blockAttributesForm('[]')!;
    expect(valuesOf(form, {})).toBe('[]');
    expect(valuesOf(form, { title: 'Steps', style: 'loweralpha' })).toBe('.Steps\n[loweralpha]');
  });

  it('leaves anchors and several lists to the source', () => {
    expect(blockAttributesForm('[[a]]\n[square]')).toBeNull();
    expect(blockAttributesForm('[square]\n[.lead]')).toBeNull();
  });
});
