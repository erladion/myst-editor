import { describe, expect, it } from 'vitest';
import { checkDoc } from '../src/core/checks.js';
import { loadDocument } from '../src/core/document.js';

const kinds = (text: string) => checkDoc(loadDocument(text).doc).map((f) => [f.kind, f.message]);

describe('checkDoc', () => {
  it('finds nothing on a page that’s fine', () => {
    expect(kinds('# Title\n\nIntro, see [the install guide](install.md).\n\n## Steps\n\n![A diagram](d.png)\n\n### Detail\n\nText.\n')).toEqual([]);
  });

  it('finds images and figures without a description', () => {
    expect(kinds('# T\n\nText ![](a.png) here.\n\n:::{figure} b.png\nCaption\n:::\n').map(([k]) => k)).toEqual(['image-alt', 'figure-alt']);
  });

  it('finds headings that skip a level, and a second title', () => {
    expect(kinds('# Guide\n\nText.\n\n### Too deep\n\nText.\n\n# Another title\n\nText.\n')).toEqual([
      ['heading-skip', '“Too deep” skips a level: a subheading after a title.'],
      ['two-titles', '“Another title” is a second title on the page: the page’s other sections should be headings.'],
    ]);
  });

  it('finds links that only say “here”', () => {
    expect(kinds('# T\n\nRead more [here](x.md). And [click here.](y.md) But [the guide](z.md).\n').map(([k, m]) => [k, m.split(':')[0]])).toEqual([
      ['link-text', 'The link says only “here”'],
      ['link-text', 'The link says only “click here.”'],
    ]);
  });

  it('finds an empty header row, and sections with nothing in them', () => {
    expect(kinds('# T\n\nText.\n\n## Empty\n\n## Full\n\n|   |   |\n|---|---|\n| a | b |\n\n## Last\n').map(([k]) => k)).toEqual(['empty-section', 'table-header', 'empty-section']);
  });
});
