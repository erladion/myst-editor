import { describe, expect, it } from 'vitest';
import { CODE_FONTS, layoutScript, TEXT_FONTS } from '../src/main/pdf/layout.js';

describe('layoutScript', () => {
  it('is a script that parses, with the options in it', () => {
    const script = layoutScript({
      rootDoc: 'index', paper: 'A4', title: 'A "quoted" title', subtitle: '{date}', note: 'Line one\nline two',
      coverLogo: null, coverBackground: null, coverColor: null, coverImages: [], marginLogo: null,
      header: ['', '', '{chapter}'], footer: ['', '{page}', ''], fonts: { text: TEXT_FONTS, heading: TEXT_FONTS, code: CODE_FONTS, faces: '' },
      numbering: 'content', tocDepth: 2, date: 'today', project: 'P',
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
