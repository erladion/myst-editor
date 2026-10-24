import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fontInfo } from '../src/main/pdf/fonts.js';

const dir = join(import.meta.dirname, '..', 'e2e', 'fixture-showcase', 'docs', '_static', 'fonts');
const info = (name: string) => fontInfo(readFileSync(join(dir, name)), name);

describe('fontInfo', () => {
  it('reads the family, weight and style from the font’s own tables', () => {
    expect(info('KaTeX_SansSerif-Regular.ttf')).toEqual({ family: 'KaTeX_SansSerif', weight: '400', style: 'normal' });
    expect(info('KaTeX_SansSerif-Bold.woff')).toEqual({ family: 'KaTeX_SansSerif', weight: '700', style: 'normal' });
  });

  it('goes by the file’s name where it can’t read them (WOFF2)', () => {
    expect(info('KaTeX_SansSerif-Italic.woff2')).toEqual({ family: 'KaTeX_SansSerif', weight: '400', style: 'italic' });
    expect(fontInfo(Buffer.from('not a font'), 'Brand Sans-SemiBoldItalic.otf')).toEqual({ family: 'Brand Sans', weight: '600', style: 'italic' });
  });
});
