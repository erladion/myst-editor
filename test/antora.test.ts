// Antora components: found by their antora.yml, their resource IDs, and built with
// Asciidoctor.js as Antora would build them.
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { openProject } from '../src/main/project.js';
import { buildAsciidoctor, onePage } from '../src/main/asciidoctor/build.js';
import { selectLines } from '../src/main/asciidoctor/antora.js';
import { parseResourceId, resolveResource, resourceIdFor, type Antora } from '../src/core/asciidoc/antora.js';
import { projectFor } from '../src/shared/projects.js';
import type { AsciidocConfig } from '../src/core/asciidoc/config.js';

function folder(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'antora-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>\n';

export const COMPONENT = {
  'docs/antora.yml': "name: shop\ntitle: The Shop\nversion: '2.0'\nnav:\n- modules/ROOT/nav.adoc\nasciidoc:\n  attributes:\n    product: ShopKeeper\n    support-email: help@example.com\n    draft: false\n",
  'docs/modules/ROOT/nav.adoc': '* xref:index.adoc[]\n* xref:install.adoc[]\n** xref:topic/linux.adoc[On Linux]\n* Reference\n** xref:admin:users.adoc[]\n* xref:other::index.adoc[Elsewhere]\n',
  'docs/modules/ROOT/pages/index.adoc': '= Welcome to {product}\n\nSee xref:install.adoc[] and xref:admin:users.adoc#roles[the roles].\n\nimage::logo.svg[Logo]\n\ninclude::partial$note.adoc[]\n',
  'docs/modules/ROOT/pages/install.adoc': '= Installing\n\nimage:admin:shield.svg[Shield,16] Installs anywhere. Back to xref:index.adoc[home].\n\n[source,sh]\n----\ninclude::example$install.sh[tag=run]\n----\n',
  'docs/modules/ROOT/pages/topic/linux.adoc': '= On Linux\n\nUp: xref:install.adoc[]. Beside it: xref:./more.adoc[].\n',
  'docs/modules/ROOT/pages/topic/more.adoc': '= More on Linux\n',
  'docs/modules/ROOT/pages/unlisted.adoc': '= Not in the navigation\n',
  'docs/modules/ROOT/pages/_hidden.adoc': '= Hidden\n',
  'docs/modules/ROOT/partials/note.adoc': 'NOTE: Mail {support-email} about {nothing}.\n',
  'docs/modules/ROOT/examples/install.sh': '# tag::run[]\ncurl example.com | sh\n# end::run[]\necho done\n',
  'docs/modules/ROOT/images/logo.svg': SVG,
  'docs/modules/admin/images/shield.svg': SVG,
  'docs/modules/admin/pages/users.adoc': '= Users\n\n[#roles]\n== Roles\n\nGo xref:ROOT:index.adoc[home].\n',
  'README.adoc': '= The shop’s code\n',
};

const SHOP: Antora = { root: 'docs', name: 'shop', version: '2.0', title: 'The Shop', nav: ['modules/ROOT/nav.adoc'], startPage: null };

describe('resource IDs', () => {
  it('have parts', () => {
    expect(parseResourceId('install.adoc')).toEqual({ version: null, component: null, module: null, family: null, path: 'install.adoc', fragment: null });
    expect(parseResourceId('2.0@shop:admin:users.adoc#roles')).toEqual({ version: '2.0', component: 'shop', module: 'admin', family: null, path: 'users.adoc', fragment: 'roles' });
    expect(parseResourceId('shop::index.adoc')).toMatchObject({ component: 'shop', module: 'ROOT' });
    expect(parseResourceId('ROOT:partial$note.adoc')).toMatchObject({ module: 'ROOT', family: 'partial', path: 'note.adoc' });
    expect(parseResourceId('https://example.com/a.png')).toBeNull();
  });

  it('name files in the module, from the family’s folder', () => {
    const from = 'modules/ROOT/pages/topic/linux.adoc';
    expect(resolveResource(SHOP, from, 'install.adoc', 'page')).toEqual({ file: 'modules/ROOT/pages/install.adoc', fragment: null });
    expect(resolveResource(SHOP, from, './more.adoc#x', 'page')).toEqual({ file: 'modules/ROOT/pages/topic/more.adoc', fragment: 'x' });
    expect(resolveResource(SHOP, from, 'admin:users.adoc', 'page')?.file).toBe('modules/admin/pages/users.adoc');
    expect(resolveResource(SHOP, from, 'logo.svg', 'image')?.file).toBe('modules/ROOT/images/logo.svg');
    expect(resolveResource(SHOP, from, 'partial$note.adoc', 'page')?.file).toBe('modules/ROOT/partials/note.adoc');
    expect(resolveResource(SHOP, 'modules/admin/nav.adoc', 'users.adoc', 'page')?.file).toBe('modules/admin/pages/users.adoc');
    // Another component's, or an anchor's name.
    expect(resolveResource(SHOP, from, 'other::index.adoc', 'page')).toBeNull();
    expect(resolveResource(SHOP, from, 'roles', 'page')).toBeNull();
  });

  it('are written as short as they can be', () => {
    const from = 'modules/ROOT/pages/topic/linux.adoc';
    expect(resourceIdFor(from, 'modules/ROOT/pages/install.adoc', 'page')).toBe('install.adoc');
    expect(resourceIdFor(from, 'modules/admin/pages/users.adoc', 'page')).toBe('admin:users.adoc');
    expect(resourceIdFor(from, 'modules/ROOT/pages/install.adoc', 'page', { qualified: true })).toBe('ROOT:install.adoc');
    expect(resourceIdFor(from, 'modules/ROOT/pages/topic/more.adoc', 'page', { relative: true })).toBe('./more.adoc');
    expect(resourceIdFor(from, 'modules/ROOT/pages/install.adoc', 'page', { relative: true })).toBe('install.adoc');
    expect(resourceIdFor(from, 'modules/ROOT/partials/note.adoc', 'partial', { implied: 'page' })).toBe('partial$note.adoc');
    expect(resourceIdFor(from, 'modules/admin/images/shield.svg', 'image')).toBe('admin:shield.svg');
    expect(resourceIdFor(from, 'elsewhere/x.svg', 'image')).toBeNull();
  });
});

describe('an included file’s lines', () => {
  it('by tag and by number', () => {
    const text = 'a\n// tag::one[]\nb\n// end::one[]\n// tag::two[]\nc\n// end::two[]\nd\n';
    expect(selectLines(text, { tag: 'one' })).toBe('b');
    expect(selectLines(text, { tags: 'one;two' })).toBe('b\nc');
    expect(selectLines(text, { tags: '!two' })).toBe('a\nb\nd');
    expect(selectLines(text, { lines: '1;7..-1' })).toBe('a\n// end::two[]\nd');
  });
});

describe('an Antora component', () => {
  it('is a folder with an antora.yml', async () => {
    const info = await openProject(folder(COMPONENT));
    const shop = info.projects.find((p) => p.dir === 'docs')!;
    expect(shop).toMatchObject({ name: 'The Shop', builder: 'asciidoctor', marker: 'docs/antora.yml', config: { format: 'asciidoc', main: null, antora: { name: 'shop', version: '2.0', nav: ['modules/ROOT/nav.adoc'] } } });
    expect((shop.config as AsciidocConfig).attributes).toEqual({ product: 'ShopKeeper', 'support-email': 'help@example.com' });
    expect(projectFor(info.projects, 'docs/modules/ROOT/partials/note.adoc')?.id).toBe(shop.id);
    // The page outside it: on its own.
    expect(projectFor(info.projects, 'README.adoc')?.id).not.toBe(shop.id);
  });

  it('is built as Antora builds it: resource IDs, antora.yml’s attributes, contents from its navigation', async () => {
    const root = folder(COMPONENT);
    const info0 = await openProject(root);
    const shop = info0.projects.find((p) => p.dir === 'docs')!;
    const out = join(root, '_out');
    const { info, built } = await buildAsciidoctor(shop, out);
    // Its pages and navigation, not its partials or hidden pages.
    expect(built).toEqual(['modules/ROOT/nav.adoc', 'modules/ROOT/pages/index.adoc', 'modules/ROOT/pages/install.adoc', 'modules/ROOT/pages/topic/linux.adoc', 'modules/ROOT/pages/topic/more.adoc', 'modules/ROOT/pages/unlisted.adoc', 'modules/admin/pages/users.adoc']);
    const index = readFileSync(join(out, 'modules/ROOT/pages/index.html'), 'utf8');
    expect(index).toContain('<h1>Welcome to ShopKeeper</h1>');
    expect(index).toContain('<a href="install.html">Installing</a>');
    expect(index).toContain('<a href="../../admin/pages/users.html#roles">the roles</a>');
    expect(index).toContain('<img src="../images/logo.svg" alt="Logo">');
    expect(index).toContain('Mail <a href="mailto:help@example.com">');
    // The partial's card: what it brings in.
    const cards = JSON.parse(readFileSync(join(out, '_mysteditor/fragments/modules/ROOT/pages/index.json'), 'utf8')).fragments;
    expect(cards).toContainEqual({ line: 7, html: expect.stringContaining('Mail <a href="mailto:help@example.com">') });
    const install = readFileSync(join(out, 'modules/ROOT/pages/install.html'), 'utf8');
    expect(install).toContain('src="../../admin/images/shield.svg"');
    expect(install).toContain('curl example.com | sh');
    expect(install).not.toContain('echo done');
    const linux = readFileSync(join(out, 'modules/ROOT/pages/topic/linux.html'), 'utf8');
    expect(linux).toContain('<a href="../install.html">Installing</a>');
    expect(linux).toContain('<a href="more.html">More on Linux</a>');
    // The missing attribute is the partial's, said once.
    expect(info.warnings.filter((w) => /nothing/.test(w.message)).map((w) => [w.source, w.line])).toEqual([['docs/modules/ROOT/partials/note.adoc', 1]]);
    // Contents: the navigation file at the top, its heading over the page under it.
    expect(info.rootDoc).toBe('modules/ROOT/nav');
    expect(info.docs['modules/ROOT/nav']).toMatchObject({ title: 'The Shop', source: 'docs/modules/ROOT/nav.adoc', children: ['modules/ROOT/pages/index', 'modules/ROOT/pages/install', 'modules/ROOT/nav#1'] });
    expect(info.docs['modules/ROOT/pages/install'].children).toEqual(['modules/ROOT/pages/topic/linux']);
    expect(info.docs['modules/ROOT/nav#1']).toMatchObject({ title: 'Reference', source: 'docs/modules/ROOT/nav.adoc', children: ['modules/admin/pages/users'] });
    expect(info.docs['modules/ROOT/pages/unlisted'].children).toEqual([]);
    expect(info.objects.find((o) => o.name === 'roles')).toMatchObject({ doc: 'modules/admin/pages/users' });
  });

  it('builds again what a changed partial is in', async () => {
    const root = folder(COMPONENT);
    const shop = (await openProject(root)).projects.find((p) => p.dir === 'docs')!;
    const out = join(root, '_out');
    const first = await buildAsciidoctor(shop, out);
    writeFileSync(join(root, 'docs/modules/ROOT/partials/note.adoc'), 'NOTE: Changed.\n');
    const second = await buildAsciidoctor(shop, out, { previous: first.cache, changed: ['modules/ROOT/partials/note.adoc'] });
    expect(second.built).toEqual(['modules/ROOT/pages/index.adoc']);
    expect(readFileSync(join(out, 'modules/ROOT/pages/index.html'), 'utf8')).toContain('Changed.');
    // And between sessions, by what's on disk.
    writeFileSync(join(root, 'docs/modules/ROOT/partials/note.adoc'), 'NOTE: Changed again.\n');
    const third = await buildAsciidoctor(shop, out, { previous: JSON.parse(JSON.stringify(second.cache)) });
    expect(third.built).toEqual(['modules/ROOT/pages/index.adoc']);
  });

  it('is one page in its navigation’s order, for a PDF', async () => {
    const root = folder(COMPONENT);
    const shop = (await openProject(root)).projects.find((p) => p.dir === 'docs')!;
    const page = await onePage(shop, join(root, '_pdf'), false);
    const html = readFileSync(page.html, 'utf8');
    const order = ['Welcome to ShopKeeper', 'Installing', 'On Linux', 'Reference', 'Users'].map((t) => html.indexOf(`>${t}</h`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain('Not in the navigation');
    // Links between pages lead to where they are in it; pictures are in it.
    expect(html).toContain('href="#roles"');
    expect(html).toContain('href="#document-modules/ROOT/pages/install"');
    expect(html).toContain('src="data:image/svg+xml;base64,');
  });
});
