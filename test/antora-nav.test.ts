// An Antora component's navigation files, changed as its contents are: pages added,
// taken out and moved, with only the lines that change written anew.
import { describe, expect, it } from 'vitest';
import { EditorState, type Transaction } from 'prosemirror-state';
import { loadDocument, saveDocument } from '../src/core/document.js';
import { ASCIIDOC_CONFIG } from '../src/core/asciidoc/config.js';
import { schema } from '../src/core/schema.js';
import type { Antora } from '../src/core/asciidoc/antora.js';
import { addToNav, insertInNav, itemOf, moveInNav, removeFromNav, takeOutOfNav } from '../src/renderer/src/builders/antora/contents.js';

const SHOP: Antora = { root: 'docs', name: 'shop', version: '2.0', title: 'The Shop', nav: ['modules/ROOT/nav.adoc', 'modules/admin/nav.adoc'], startPage: null };
const ROOT_NAV = 'modules/ROOT/nav.adoc';
const page = (p: string) => `modules/ROOT/pages/${p}`;

const NAV = '.Getting started\n* xref:index.adoc[]\n* xref:install.adoc[]\n** xref:topic/linux.adoc[On Linux]\n* Reference\n** xref:admin:users.adoc[]\n';

function edited(text: string, fn: (state: EditorState) => Transaction | string): string {
  const { doc, map } = loadDocument(text, ASCIIDOC_CONFIG);
  const state = EditorState.create({ doc, schema });
  const tr = fn(state);
  if (typeof tr === 'string') throw new Error(tr);
  return saveDocument(tr.doc, map, ASCIIDOC_CONFIG).text;
}

describe('a navigation file', () => {
  it('gets a new page at its end', () => {
    expect(edited(NAV, (s) => addToNav(s, SHOP, ROOT_NAV, page('topic/more.adoc')))).toBe(`${NAV}* xref:topic/more.adoc[]\n`);
    expect(edited('', (s) => addToNav(s, SHOP, ROOT_NAV, page('index.adoc')))).toBe('* xref:index.adoc[]');
  });

  it('loses a page, and what was under it stays where it was', () => {
    expect(edited(NAV, (s) => removeFromNav(s, SHOP, ROOT_NAV, page('install.adoc')))).toBe('.Getting started\n* xref:index.adoc[]\n* xref:topic/linux.adoc[On Linux]\n* Reference\n** xref:admin:users.adoc[]\n');
    expect(edited(NAV, (s) => removeFromNav(s, SHOP, ROOT_NAV, 'modules/admin/pages/users.adoc'))).toBe('.Getting started\n* xref:index.adoc[]\n* xref:install.adoc[]\n** xref:topic/linux.adoc[On Linux]\n* Reference\n');
  });

  it('moves a page with what’s under it: under a heading, under a page, before another', () => {
    expect(edited(NAV, (s) => moveInNav(s, SHOP, ROOT_NAV, page('install.adoc'), 'modules/ROOT/nav#1', null))).toBe(
      '.Getting started\n* xref:index.adoc[]\n* Reference\n** xref:admin:users.adoc[]\n** xref:install.adoc[]\n*** xref:topic/linux.adoc[On Linux]\n',
    );
    expect(edited(NAV, (s) => moveInNav(s, SHOP, ROOT_NAV, page('topic/linux.adoc'), 'modules/ROOT/pages/index', null))).toBe(
      '.Getting started\n* xref:index.adoc[]\n** xref:topic/linux.adoc[On Linux]\n* xref:install.adoc[]\n* Reference\n** xref:admin:users.adoc[]\n',
    );
    expect(edited(NAV, (s) => moveInNav(s, SHOP, ROOT_NAV, page('install.adoc'), 'modules/ROOT/nav', page('index.adoc')))).toBe(
      '.Getting started\n* xref:install.adoc[]\n** xref:topic/linux.adoc[On Linux]\n* xref:index.adoc[]\n* Reference\n** xref:admin:users.adoc[]\n',
    );
    // One that wasn't listed: added there.
    expect(edited(NAV, (s) => moveInNav(s, SHOP, ROOT_NAV, page('unlisted.adoc'), 'modules/ROOT/nav#1', 'modules/admin/pages/users.adoc'))).toBe(
      '.Getting started\n* xref:index.adoc[]\n* xref:install.adoc[]\n** xref:topic/linux.adoc[On Linux]\n* Reference\n** xref:unlisted.adoc[]\n** xref:admin:users.adoc[]\n',
    );
  });

  it('gives a page to another module’s, its xrefs written from there', () => {
    const { doc } = loadDocument(NAV, ASCIIDOC_CONFIG);
    const node = itemOf(EditorState.create({ doc, schema }), SHOP, ROOT_NAV, page('install.adoc'), 'modules/admin/nav.adoc');
    expect(edited('* xref:users.adoc[]\n', (s) => insertInNav(s, SHOP, 'modules/admin/nav.adoc', node, 'modules/admin/nav', null))).toBe(
      '* xref:users.adoc[]\n* xref:ROOT:install.adoc[]\n** xref:ROOT:topic/linux.adoc[On Linux]\n',
    );
    expect(edited(NAV, (s) => takeOutOfNav(s, SHOP, ROOT_NAV, page('install.adoc')))).toBe('.Getting started\n* xref:index.adoc[]\n* Reference\n** xref:admin:users.adoc[]\n');
  });
});

describe('a renamed or moved page in a component', () => {
  const config = { ...ASCIIDOC_CONFIG, antora: SHOP };
  const rename = async (text: string, folder: string, from: string, to: string, moved = false, after = folder) => {
    const { renameAsciidocReferences } = await import('../src/renderer/src/formats/asciidoc/rename.js');
    return edited(text, (s) => renameAsciidocReferences(s, { folder: { before: folder, after }, page: { from: from.replace(/\.adoc$/, ''), to: to.replace(/\.adoc$/, '') }, file: { from, to }, moved, config }));
  };

  it('is referred to by its new resource ID, as it was written', async () => {
    expect(await rename(NAV, 'modules/ROOT', page('install.adoc'), page('setup/install.adoc'))).toBe(NAV.replace('xref:install.adoc[]', 'xref:setup/install.adoc[]'));
    expect(await rename('See xref:ROOT:install.adoc#x[it].\n', 'modules/admin/pages', page('install.adoc'), 'modules/admin/pages/install.adoc')).toBe('See xref:admin:install.adoc#x[it].\n');
    expect(await rename('See xref:./more.adoc[].\n', 'modules/ROOT/pages/topic', page('topic/more.adoc'), page('topic/much-more.adoc'))).toBe('See xref:./much-more.adoc[].\n');
  });

  it('moved to another module, names what it did from there', async () => {
    const text = '= Install\n\nSee xref:index.adoc[].\n\nimage::logo.svg[]\n\ninclude::partial$note.adoc[]\n';
    expect(await rename(text, 'modules/ROOT/pages', page('install.adoc'), 'modules/admin/pages/install.adoc', true, 'modules/admin/pages')).toBe(
      '= Install\n\nSee xref:ROOT:index.adoc[].\n\nimage::ROOT:logo.svg[]\n\ninclude::ROOT:partial$note.adoc[]\n',
    );
    // Within its module, nothing it names changes.
    expect(await rename(text, 'modules/ROOT/pages', page('install.adoc'), page('topic/install.adoc'), true, 'modules/ROOT/pages/topic')).toBe(text);
  });
});
