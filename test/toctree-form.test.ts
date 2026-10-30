// A toctree edited in a form: what the form changes written anew, the rest as it was.
import { describe, expect, it } from 'vitest';
import { toctreeForm } from '../src/renderer/src/formats/myst/toctree.js';

const TOC = '```{toctree}\n:maxdepth: 2\n:glob:\n\ninstall\nGuide <usage/first>\n```';
const values = (source: string, patch: Record<string, string>) => {
  const form = toctreeForm(source)!;
  return form.source({ ...Object.fromEntries(form.fields.map((f) => [f.key, f.value])), ...patch });
};

describe('the toctree form', () => {
  it('has its caption, depth, whether it shows and its entries', () => {
    const form = toctreeForm(TOC)!;
    expect(form.fields.map((f) => [f.key, f.value])).toEqual([
      ['caption', ''],
      ['maxdepth', '2'],
      ['hidden', ''],
      ['entries', 'install\nGuide <usage/first>'],
    ]);
    expect(form.fields[3].lines).toBeGreaterThan(1);
  });

  it('writes back what it was given unchanged as it was', () => {
    expect(values(TOC, {})).toBe(TOC);
    const colon = ':::{toctree}\n:hidden:\n:caption:   Start\nintro\n:::';
    expect(values(colon, {})).toBe(colon);
  });

  it('changes, adds and removes options among the others, keeping their order', () => {
    expect(values(TOC, { maxdepth: '1' })).toBe(TOC.replace(':maxdepth: 2', ':maxdepth: 1'));
    expect(values(TOC, { maxdepth: '' })).toBe(TOC.replace(':maxdepth: 2\n', ''));
    expect(values(TOC, { caption: 'Contents', hidden: 'hidden' })).toBe(TOC.replace(':glob:\n', ':glob:\n:caption: Contents\n:hidden:\n'));
  });

  it('takes entries a line each', () => {
    expect(values(TOC, { entries: 'install\nGuide <usage/first>\nfaq\n\n' })).toBe(TOC.replace('first>', 'first>\nfaq'));
    expect(values('```{toctree}\n```', { entries: 'a\nb' })).toBe('```{toctree}\na\nb\n```');
    expect(values('```{toctree}\n:maxdepth: 1\n```', { entries: 'a' })).toBe('```{toctree}\n:maxdepth: 1\n\na\n```');
    expect(values(TOC, { entries: '' })).toBe('```{toctree}\n:maxdepth: 2\n:glob:\n```');
  });

  it('leaves options written as YAML to the source', () => {
    expect(toctreeForm('```{toctree}\n---\nmaxdepth: 2\n---\nintro\n```')).toBeNull();
  });
});
