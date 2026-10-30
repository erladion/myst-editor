// MyST's field lists (fieldlist): kept as written, edited in a form.
import { describe, expect, it } from 'vitest';
import { loadDocument, saveDocument } from '../src/core/document.js';
import { readConfPy, type MystConfig } from '../src/core/project-config.js';
import { fieldsForm } from '../src/renderer/src/formats/myst/fields.js';

const conf = readConfPy('extensions = ["myst_parser"]\nmyst_enable_extensions = ["fieldlist"]\n');
const PAGE = ':author: Me\n:date:   2026\n\nText.\n';

describe('a field list', () => {
  it('is a block of its own, written as it was', () => {
    const { doc, map } = loadDocument(PAGE, conf);
    expect(doc.firstChild!.attrs).toMatchObject({ kind: 'fieldlist', source: ':author: Me\n:date:   2026' });
    expect(saveDocument(doc, map, conf).text).toBe(PAGE);
    const plain: MystConfig = { ...conf, extensions: [] };
    expect(loadDocument(PAGE, plain).doc.firstChild!.type.name).toBe('paragraph');
  });

  it('is edited in a form: changed fields written anew, others as they were; one more, or one less', () => {
    const form = fieldsForm(':author: Me\n:date:   2026')!;
    expect(form.fields.map((f) => [f.label, f.value])).toEqual([['author', 'Me'], ['date', '2026'], ['Another field', '']]);
    expect(form.source({ f0: 'You', f1: '2026', new: 'status: draft' })).toBe(':author: You\n:date:   2026\n:status: draft');
    expect(form.source({ f0: '', f1: '2026', new: '' })).toBe(':date:   2026');
    // A value over lines: edited as written.
    expect(fieldsForm(':abstract: One\n  two')).toBeNull();
  });
});
