import { describe, expect, it } from 'vitest';
import { targetLabel } from '../src/renderer/src/editor/commands.js';

describe('targetLabel', () => {
  it('makes a link target label from a heading', () => {
    expect(targetLabel('Installing Widget')).toBe('installing-widget');
    expect(targetLabel('  Café & Crème: v2.1 setup_guide ')).toBe('cafe-creme-v2.1-setup-guide');
    expect(targetLabel('Why? (FAQ)')).toBe('why-faq');
  });
});
