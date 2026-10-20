import { describe, expect, it } from 'vitest';
import { addTocEntry, entryDocname, entryFor, globIncludes, insertTocEntry, removeTocEntries, retarget, takeTocEntry, tocLines } from '../src/core/toctree.js';
import { defaultContents, pageFolders, pageSlug, rankPages } from '../src/renderer/src/pages.js';
import type { ProjectInfo } from '../src/shared/api.js';

const toc = '```{toctree}\n:maxdepth: 2\n:caption: Contents\n\nguide/install\nConfiguring <guide/configure>\n```';

describe('toctree entries', () => {
  it('adds an entry at the end, keeping everything else', () => {
    expect(addTocEntry(toc, 'guide/upgrade')).toBe('```{toctree}\n:maxdepth: 2\n:caption: Contents\n\nguide/install\nConfiguring <guide/configure>\nguide/upgrade\n```');
    expect(addTocEntry(':::{toctree}\n:hidden:\n:::', 'a')).toBe(':::{toctree}\n:hidden:\n\na\n:::');
    expect(addTocEntry('```{toctree}\n```', 'a')).toBe('```{toctree}\na\n```');
    expect(addTocEntry('```{toctree}\n\nx', 'a')).toBe('```{toctree}\n\nx\na'); // never closed
  });

  it('removes entries for a page however they are written', () => {
    expect(removeTocEntries(toc, new Set(['guide/configure']), '')).toBe('```{toctree}\n:maxdepth: 2\n:caption: Contents\n\nguide/install\n```');
    expect(removeTocEntries('```{toctree}\n/guide/install\n../guide/install.md\nother\n```', new Set(['guide/install']), 'sub')).toBe('```{toctree}\nother\n```');
    expect(removeTocEntries(toc, new Set(['nothing']), '')).toBeNull();
  });

  it('writes entries relative to the page when below it, else from the top', () => {
    expect(entryFor('guide/new', '')).toBe('guide/new');
    expect(entryFor('guide/new', 'guide')).toBe('new');
    expect(entryFor('other/new', 'guide')).toBe('/other/new');
    expect(entryDocname('new', 'guide')).toBe('guide/new');
    expect(entryDocname('/other/new.md', 'guide')).toBe('other/new');
  });

  it('knows when a :glob: pattern already takes the page in', () => {
    const glob = '```{toctree}\n:glob:\n\nintro\nguide/*\n```';
    expect(globIncludes(glob, 'guide/new', '')).toBe(true);
    expect(globIncludes(glob, 'guide/deep/new', '')).toBe(false);
    expect(globIncludes(toc, 'guide/new', '')).toBe(false); // no :glob:
  });
});

describe('new pages', () => {
  const project = { files: ['docs/index.md', 'docs/guide/install.md', 'docs/guide/index.md', 'README.md'] } as ProjectInfo;
  it('makes file names from titles', () => {
    expect(pageSlug('Installing on RHEL 9')).toBe('installing-on-rhel-9');
    expect(pageSlug('Café: what’s new?')).toBe('cafe-whats-new');
    expect(pageSlug('???')).toBe('page');
  });
  it('offers the folders holding pages, and puts a page in the nearest index’s contents', () => {
    expect(pageFolders(project)).toEqual(['', 'docs', 'docs/guide']);
    expect(defaultContents(project, 'docs/guide/deep', ['docs/guide/index.md', 'docs/index.md'])).toBe('docs/guide/index.md');
    expect(defaultContents(project, 'docs/other', ['docs/guide/index.md', 'docs/index.md'])).toBe('docs/index.md');
    expect(defaultContents(project, 'elsewhere', ['docs/index.md'])).toBeNull();
  });
});

describe('moving entries', () => {
  const toc = '```{toctree}\n:caption: Guide\n\ninstall\nSetting up <configure>\n/other/faq\nhttps://example.com\n```';
  it('lists entries with their lines and page names', () => {
    expect(tocLines(toc, 'guide').map((l) => [l.line, l.docname])).toEqual([
      [3, 'guide/install'],
      [4, 'guide/configure'],
      [5, 'other/faq'],
    ]);
  });
  it('takes an entry out and puts it back elsewhere, title and all', () => {
    const taken = takeTocEntry(toc, 'guide/configure', 'guide')!;
    expect(taken.text).toBe('Setting up <configure>');
    expect(insertTocEntry(taken.source, taken.text, 'guide/install', 'guide')).toBe('```{toctree}\n:caption: Guide\n\nSetting up <configure>\ninstall\n/other/faq\nhttps://example.com\n```');
    expect(insertTocEntry(toc, 'x', 'not/here', 'guide')).toBeNull();
    expect(takeTocEntry(toc, 'not/here', 'guide')).toBeNull();
  });
  it('rewrites an entry for a toctree in another folder', () => {
    expect(retarget('Setting up <configure>', 'guide/configure', '')).toBe('Setting up <guide/configure>');
    expect(retarget('  install', 'guide/install', 'other')).toBe('  /guide/install');
    expect(retarget('install', 'guide/install', 'guide')).toBe('install');
  });
});

describe('Go to page', () => {
  const files = ['docs/index.md', 'docs/guide/install.md', 'docs/guide/configure.md', 'docs/reference/install-options.md', 'docs/faq.md'];
  const titles = { 'docs/index.md': 'Widget documentation', 'docs/guide/install.md': 'Installing Widget', 'docs/guide/configure.md': 'Configuring Widget', 'docs/reference/install-options.md': 'Options for installers', 'docs/faq.md': 'FAQ' };
  it('ranks titles that start with the text first, then ones containing it, then paths', () => {
    expect(rankPages('inst', files, titles, [])).toEqual(['docs/guide/install.md', 'docs/reference/install-options.md']);
    expect(rankPages('widget', files, titles, [])).toEqual(['docs/index.md', 'docs/guide/configure.md', 'docs/guide/install.md']);
    expect(rankPages('guide conf', files, titles, [])).toEqual(['docs/guide/configure.md']); // words in title or path
    expect(rankPages('reference', files, titles, [])).toEqual(['docs/reference/install-options.md']);
  });
  it('puts recently opened pages first', () => {
    expect(rankPages('widget', files, titles, ['docs/guide/install.md'])).toEqual(['docs/index.md', 'docs/guide/install.md', 'docs/guide/configure.md']);
    expect(rankPages('', files, titles, ['docs/faq.md', 'docs/guide/install.md']).slice(0, 3)).toEqual(['docs/faq.md', 'docs/guide/install.md', 'docs/guide/configure.md']);
  });
});
