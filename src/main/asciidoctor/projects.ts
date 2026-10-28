// Asciidoctor projects in the opened folder: a folder with a main document (one that
// includes the others, or the one its .mysteditor.toml names in [asciidoctor] main),
// or the opened folder itself, whose AsciiDoc pages then stand on their own.
import { createHash } from 'node:crypto';
import { existsSync, promises as fs, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Project } from '../../shared/api.js';
import { asciidocEditor, headerAttributes, type AsciidocConfig } from '../../core/asciidoc/config.js';
import { documentTitle } from '../../core/asciidoc/pages.js';
import { loadEditorConfig, SETTINGS_FILE } from '../../core/editor-config.js';
import { settingsSources, type FolderScan } from '../project.js';

// A folder's main document, by name: index.adoc always; the others when they
// include other pages.
const MAIN_NAMES = ['index.adoc', 'main.adoc', 'book.adoc', 'README.adoc'];
const INCLUDES_PAGE = /^include::[^\s[]+\.adoc\[/m;

const dirOf = (rel: string) => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
const inside = (dir: string, parent: string) => parent === '' || dir === parent || dir.startsWith(parent + '/');

export async function asciidoctorProjects(root: string, scan: FolderScan, read: Set<string>): Promise<Project[]> {
  const pages = scan.files.filter((f) => f.endsWith('.adoc'));
  if (!pages.length) return [];
  const mains = new Map<string, string>(); // folder → its main document
  // Named in the settings: the settings file's folder is the project's.
  const folders = new Set<string>(['']);
  for (const page of pages) for (let d = dirOf(page); d; d = dirOf(d)) folders.add(d);
  for (const dir of folders) {
    const file = join(root, dir, SETTINGS_FILE);
    if (!existsSync(file)) continue;
    const rel = dir ? `${dir}/${SETTINGS_FILE}` : SETTINGS_FILE;
    const { main } = loadEditorConfig([{ file: rel, text: readFileSync(file, 'utf8'), readCapabilities: () => '' }]).asciidoctor;
    if (main && pages.includes(main) && inside(dirOf(main), dir)) mains.set(dir, main);
  }
  for (const name of MAIN_NAMES) {
    for (const rel of pages.filter((p) => basename(p) === name)) {
      const dir = dirOf(rel);
      if (mains.has(dir)) continue;
      if (name === 'index.adoc' || INCLUDES_PAGE.test(await fs.readFile(join(root, rel), 'utf8').catch(() => ''))) mains.set(dir, rel);
    }
  }
  // The outermost: a book's chapters' folders are the book's.
  const found = [...mains].filter(([dir]) => ![...mains.keys()].some((d) => d !== dir && inside(dir, d)));
  // No main document anywhere: the folder's pages, each on its own.
  if (!found.length) found.push(['', '']);
  const projects: Project[] = [];
  for (const [dir, main] of found) {
    const sourceDir = dir ? join(root, dir) : root;
    const text = main ? await fs.readFile(join(root, main), 'utf8').catch(() => '') : '';
    const config: AsciidocConfig = {
      format: 'asciidoc',
      editor: asciidocEditor(loadEditorConfig(settingsSources(root, sourceDir, read))),
      main: main ? (dir ? main.slice(dir.length + 1) : main) : null,
      attributes: headerAttributes(text),
    };
    projects.push({
      id: `a${createHash('sha256').update(sourceDir).digest('hex').slice(0, 12)}`,
      name: (text && documentTitle(text)) || basename(sourceDir),
      builder: 'asciidoctor',
      dir,
      sourceDir,
      marker: main || dir || '.',
      config,
    });
  }
  return projects;
}
