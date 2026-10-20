import { describe, expect, it } from 'vitest';
import { addTocEntry, entryDocname, entryFor, globIncludes, removeTocEntries } from '../src/core/toctree.js';
import { defaultContents, pageFolders, pageSlug } from '../src/renderer/src/pages.js';
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
