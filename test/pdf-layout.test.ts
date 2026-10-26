import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CODE_FONTS, cssWithFileUrls, layoutScript, TEXT_FONTS } from '../src/main/pdf/layout.js';

describe('layoutScript', () => {
  it('is a script that parses, with the options in it', () => {
    const script = layoutScript({
      rootDoc: 'index', paper: 'A4', title: 'A "quoted" title', subtitle: '{date}', note: 'Line one\nline two',
      coverLogo: null, coverBackground: null, coverColor: null, coverImages: [], coverPlaces: { title: { x: 20, y: 100, width: null, size: 40, align: 'center' } }, marginLogo: null,
      header: ['', '', '{chapter}'], footer: ['', '{page}', ''], fonts: { text: TEXT_FONTS, heading: TEXT_FONTS, code: CODE_FONTS, faces: '' },
      headersOn: 'all', numbering: 'content', tocDepth: 2, date: 'today', project: 'P',
    });
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain('"title":"A \\"quoted\\" title"');
  });
});

describe('headingPages', () => {
  it('matches headings to the outline in order, with Windows’ doubled titles too', async () => {
    const { headingPages } = await import('../src/main/pdf/outline.js');
    const entries = [
      { title: 'Install HarborInstall Harbor', page: 4 },
      { title: 'Deploy your first serviceDeploy your first service', page: 5 },
      { title: 'Deploy', page: 5 },
      { title: 'Secrets', page: 6 },
    ];
    expect(headingPages(['Install Harbor', 'Deploy your first service', 'Deploy', 'Missing', 'Secrets'], entries)).toEqual([4, 5, 5, 0, 6]);
  });
});

describe('the PDF stylesheet', () => {
  it('refers to its fonts and images by where they are, next to it', () => {
    const dir = join('/projects', 'docs', '_static');
    const at = (f: string) => pathToFileURL(join(dir, f)).href;
    const css = cssWithFileUrls(`@import "print-extra.css";\n@font-face { src: url(fonts/Brand.woff2) format("woff2"), url('../fonts/Brand.ttf'); }\nbody { background: url("data:image/png;base64,AA") , url(https://example.com/a.png); }\nh1 { filter: url(#glow); }`, dir);
    expect(css).toBe(`@import "${at('print-extra.css')}";\n@font-face { src: url(${at('fonts/Brand.woff2')}) format("woff2"), url('${at('../fonts/Brand.ttf')}'); }\nbody { background: url("data:image/png;base64,AA") , url(https://example.com/a.png); }\nh1 { filter: url(#glow); }`);
  });
});
