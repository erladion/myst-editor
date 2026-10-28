// Asciidoctor projects: found by their main document, and built with Asciidoctor.js.
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { openProject } from '../src/main/project.js';
import { buildAsciidoctor } from '../src/main/asciidoctor/build.js';
import { configFor, projectFor } from '../src/shared/projects.js';

function folder(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'adoc-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

const BOOK = {
  'book/index.adoc': '= The Book\n:product: Widget\n\ninclude::chapters/one.adoc[leveloffset=+1]\n\ninclude::chapters/two.adoc[leveloffset=+1]\n',
  'book/chapters/one.adoc': '= Chapter One\n\n[[intro]]\n== Intro\n\nAbout {product}, and {missing}.\n',
  'book/chapters/two.adoc': '= Chapter Two\n\n[#start]\n== Start\n\nSee <<intro>>.\n\ninclude::nope.adoc[]\n',
  'docs/conf.py': 'project = "Docs"\nextensions = ["myst_parser"]\n',
  'docs/index.md': '# Docs\n',
  'notes.adoc': '= Notes\n',
};

describe('an Asciidoctor project', () => {
  it('is a folder with a main document, beside Sphinx projects', async () => {
    const info = await openProject(folder(BOOK));
    const book = info.projects.find((p) => p.builder === 'asciidoctor')!;
    expect(book).toMatchObject({ name: 'The Book', dir: 'book', marker: 'book/index.adoc', config: { format: 'asciidoc', main: 'index.adoc', attributes: { product: 'Widget' } } });
    expect(info.projects.map((p) => p.builder)).toEqual(['asciidoctor', 'sphinx']);
    // Its pages are its; Markdown pages are Sphinx's; an AsciiDoc page outside both is read as AsciiDoc.
    expect(projectFor(info.projects, 'book/chapters/one.adoc')?.id).toBe(book.id);
    expect(projectFor(info.projects, 'docs/index.md')?.builder).toBe('sphinx');
    expect(projectFor(info.projects, 'notes.adoc')).toBeNull();
    expect(configFor(info, 'notes.adoc').format).toBe('asciidoc');
  });

  it('without a main document: the folder, its pages each on its own', async () => {
    const info = await openProject(folder({ 'a.adoc': '= A\n', 'sub/b.adoc': '= B\n' }));
    expect(info.projects).toMatchObject([{ builder: 'asciidoctor', dir: '', config: { main: null } }]);
  });

  it('builds each page, with the include tree, anchors and warnings', async () => {
    const root = folder(BOOK);
    const info = await openProject(root);
    const book = info.projects.find((p) => p.builder === 'asciidoctor')!;
    const out = join(root, '.out');
    const built = await buildAsciidoctor(book, out);
    expect(built.builtWith.name).toBe('Asciidoctor');
    expect(built.rootDoc).toBe('index');
    expect(built.docs.index).toMatchObject({ source: 'book/index.adoc', title: 'The Book', uri: 'index.html', children: ['chapters/one', 'chapters/two'] });
    expect(built.docs['chapters/one']).toMatchObject({ source: 'book/chapters/one.adoc', title: 'Chapter One', children: [] });
    expect(built.objects.filter((o) => o.type === 'section' && !o.name.startsWith('_')).map((o) => [o.name, o.title, o.doc])).toEqual([
      ['intro', 'Intro', 'chapters/one'],
      ['start', 'Start', 'chapters/two'],
    ]);
    // Where Asciidoctor says: the include that's missing, on its line.
    expect(built.warnings).toContainEqual(expect.objectContaining({ source: 'book/chapters/two.adoc', line: 8, level: 'error', message: expect.stringMatching(/include file not found/) }));
    expect(built.warnings.some((w) => /missing attribute: missing/.test(w.message))).toBe(true);
    // The pages, with the main document's attributes, and Asciidoctor's stylesheet.
    expect(readFileSync(join(out, 'chapters/one.html'), 'utf8')).toContain('About Widget');
    expect(readFileSync(join(out, 'chapters/one.html'), 'utf8')).toContain('href="../asciidoctor.css"');
    expect(existsSync(join(out, 'asciidoctor.css'))).toBe(true);
  });
});
