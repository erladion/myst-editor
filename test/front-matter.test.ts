// A page's front matter, edited in a form: a changed value replaced where it's
// written, the rest of the YAML as it was.
import { describe, expect, it } from 'vitest';
import { frontMatterForm } from '../src/renderer/src/formats/myst/frontmatter.js';

const FRONT = '---\n# Page settings\ntitle: "Install"\norphan: true\nhtml_meta:\n  description: How to install it  # for search engines\nmyst:\n  substitutions:\n    product: Widget\n---';

describe('front matter', () => {
  const form = frontMatterForm(FRONT)!;
  const values = (patch: Record<string, string>) => ({ ...Object.fromEntries(form.fields.map((f) => [f.key, f.value])), ...patch });

  it('has a field for each value of one line, at any depth', () => {
    expect(form.fields.map((f) => [f.label, f.value])).toEqual([
      ['title', 'Install'],
      ['orphan', 'true'],
      ['html_meta.description', 'How to install it'],
      ['myst.substitutions.product', 'Widget'],
      ['Another setting', ''],
    ]);
  });

  it('changes a value where it is, keeping the comments, the quotes and the rest', () => {
    expect(form.source(values({}))).toBe(FRONT);
    expect(form.source(values({ s2: 'Install it on Linux', s3: 'Gadget' }))).toBe(FRONT.replace('How to install it ', 'Install it on Linux ').replace('product: Widget', 'product: Gadget'));
    expect(form.source(values({ s0: 'Setup' }))).toBe(FRONT.replace('"Install"', 'Setup'));
    expect(form.source(values({ s1: 'false' }))).toBe(FRONT.replace('orphan: true', 'orphan: false'));
  });

  it('takes a setting out, or adds one', () => {
    expect(form.source(values({ s1: '' }))).toBe(FRONT.replace('orphan: true\n', ''));
    expect(form.source(values({ new: 'tocdepth: 2' }))).toBe(FRONT.replace('\n---', '\ntocdepth: 2\n---').replace('---\n# Page', '---\n# Page'));
  });
});
