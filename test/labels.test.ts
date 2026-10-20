import { describe, expect, it } from 'vitest';
import { targetLabel } from '../src/renderer/src/editor/commands.js';
import { inlineTag } from '../src/renderer/src/editor/html.js';

describe('targetLabel', () => {
  it('makes a link target label from a heading', () => {
    expect(targetLabel('Installing Widget')).toBe('installing-widget');
    expect(targetLabel('  Café & Crème: v2.1 setup_guide ')).toBe('cafe-creme-v2.1-setup-guide');
    expect(targetLabel('Why? (FAQ)')).toBe('why-faq');
  });
});

describe('inlineTag', () => {
  it('reads the inline HTML tags pages use', () => {
    expect(inlineTag('<br>')).toEqual({ name: 'br', kind: 'void', attrs: false });
    expect(inlineTag('<br />')).toEqual({ name: 'br', kind: 'void', attrs: false });
    expect(inlineTag('<LI>')).toEqual({ name: 'li', kind: 'open', attrs: false });
    expect(inlineTag('</ul>')).toEqual({ name: 'ul', kind: 'close', attrs: false });
    expect(inlineTag('<span style="color: red">')).toEqual({ name: 'span', kind: 'open', attrs: true });
    expect(inlineTag('<!-- if: X -->')).toBeNull();
    expect(inlineTag('&nbsp;')).toBeNull();
  });
});
