import { describe, expect, it } from 'vitest';
import { relativePath, rewriteRef, rewriteTitled } from '../src/core/rename.js';

const stay = (dir: string) => ({ before: dir, after: dir });

describe('rewriting references to a renamed page', () => {
  const rename = { from: 'guide/install', to: 'setup/installing' };
  it('rewrites references to it, keeping how they were written', () => {
    expect(rewriteRef('install', stay('guide'), rename)).toBe('../setup/installing');
    expect(rewriteRef('guide/install', stay(''), rename)).toBe('setup/installing');
    expect(rewriteRef('/guide/install', stay('other'), rename)).toBe('/setup/installing');
    expect(rewriteRef('../guide/install', stay('other'), rename)).toBe('../setup/installing');
  });
  it('keeps anchors, and links to files by their file name', () => {
    expect(rewriteRef('install.md#configuration', stay('guide'), { from: 'guide/install.md', to: 'guide/installing.md' })).toBe('installing.md#configuration');
  });
  it('leaves other references, URLs and anchors alone', () => {
    expect(rewriteRef('configure', stay('guide'), rename)).toBeNull();
    expect(rewriteRef('https://example.com/guide/install', stay('guide'), rename)).toBeNull();
    expect(rewriteRef('#top', stay('guide'), rename)).toBeNull();
  });
  it('rewrites a moved page’s own relative references for its new folder', () => {
    const moved = { before: 'guide', after: 'setup' };
    expect(rewriteRef('images/diagram.svg', moved, null)).toBe('../guide/images/diagram.svg');
    expect(rewriteRef('configure', moved, rename)).toBe('../guide/configure');
    expect(rewriteRef('/index', moved, rename)).toBeNull(); // absolute: still right
    expect(rewriteRef('install', moved, rename)).toBe('installing'); // itself
  });
  it('keeps a title written with the target', () => {
    expect(rewriteTitled('Installing it <install>', (t) => rewriteRef(t, stay('guide'), rename))).toBe('Installing it <../setup/installing>');
    expect(rewriteTitled('install', (t) => rewriteRef(t, stay('guide'), rename))).toBe('../setup/installing');
    expect(rewriteTitled('configure', (t) => rewriteRef(t, stay('guide'), rename))).toBeNull();
  });
  it('writes paths relative to a folder', () => {
    expect(relativePath('', 'a/b')).toBe('a/b');
    expect(relativePath('a', 'a/b')).toBe('b');
    expect(relativePath('a/c', 'a/b')).toBe('../b');
    expect(relativePath('x/y', 'a/b')).toBe('../../a/b');
  });
});
