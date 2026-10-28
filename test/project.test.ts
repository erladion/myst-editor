import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildInputsOf, placeImage, saveImage, searchPages, listDocuments, openProject, resolveForReading, resolveInside, unwatchedDir } from '../src/main/project.js';
import { firstHeading } from '../src/core/myst/pages.js';
import { FolderWatcher } from '../src/main/watch.js';

function project() {
  const root = mkdtempSync(join(tmpdir(), 'mysteditor-test-'));
  mkdirSync(join(root, 'docs', 'guide'), { recursive: true });
  mkdirSync(join(root, 'docs', '_build'));
  mkdirSync(join(root, 'outside'));
  writeFileSync(join(root, 'docs', 'conf.py'), 'myst_enable_extensions = ["colon_fence"]\n');
  writeFileSync(join(root, 'docs', 'index.md'), '---\ntitle: x\n---\n# Home *page*\n');
  writeFileSync(join(root, 'docs', 'guide', 'a.md'), '```\n# not a title\n```\n\nSetext title\n============\n');
  writeFileSync(join(root, 'docs', '_build', 'junk.md'), '# built\n');
  writeFileSync(join(root, 'outside', 'secret.md'), 'secret');
  return root;
}

describe('openProject', () => {
  it('finds conf.py in docs/, reads its MyST extensions and lists pages with titles', async () => {
    const root = project();
    const p = await openProject(root);
    expect(p.projects).toHaveLength(1);
    expect(p.projects[0]).toMatchObject({ dir: 'docs', sourceDir: join(p.root, 'docs'), builder: 'sphinx', marker: 'docs/conf.py', config: { extensions: ['colon_fence'] } });
    expect(p.files).toEqual(['docs/guide/a.md', 'docs/index.md', 'outside/secret.md']);
    expect(p.titles).toEqual({ 'docs/index.md': 'Home page', 'docs/guide/a.md': 'Setext title' }); // secret.md has no heading
  });

  it('reports progress while opening', async () => {
    const steps: string[] = [];
    await openProject(project(), (step, detail) => steps.push(detail ? `${step}: ${detail}` : step));
    expect(steps[0]).toBe('Looking for pages and projects');
    expect(steps).toContain('Looking for pages and projects: 3 pages found');
    expect(steps.at(-1)).toBe('Reading page titles: 3 of 3');
  });

  it('fingerprints the Python and capabilities files a build reads, not other data', async () => {
    const root = project();
    writeFileSync(join(root, 'docs', '.mysteditor.toml'), '[conditions]\ncapabilities = "caps.json"\n');
    writeFileSync(join(root, 'docs', 'caps.json'), '["A"]');
    const before = (await openProject(root)).buildInputs;
    const touch = (path: string, time: number) => utimesSync(path, time, time);
    writeFileSync(join(root, 'docs', 'generated.json'), '{"built": 1}'); // e.g. written by every build
    expect(await buildInputsOf(root)).toBe(before);
    touch(join(root, 'docs', 'caps.json'), 1_000_000);
    const caps = await buildInputsOf(root);
    expect(caps).not.toBe(before);
    writeFileSync(join(root, 'docs', '_ext.py'), 'def setup(app): pass\n');
    expect(await buildInputsOf(root)).not.toBe(caps);
  });

  it('lists pages in folders named like build output when they hold pages, and symlinked ones', async () => {
    const root = project();
    const docs = join(root, 'docs');
    mkdirSync(join(docs, 'build'));
    writeFileSync(join(docs, 'build', 'linux.md'), '# Building on Linux\n'); // a "Building" section
    mkdirSync(join(docs, 'env'));
    writeFileSync(join(docs, 'env', 'vars.md'), '# Environment variables\n');
    mkdirSync(join(root, 'dist', 'pkg'), { recursive: true });
    writeFileSync(join(root, 'dist', 'pkg', 'README.md'), '# Packaged copy\n'); // packaging output
    mkdirSync(join(root, 'conda'));
    mkdirSync(join(root, 'conda', 'conda-meta'));
    writeFileSync(join(root, 'conda', 'notes.md'), '# In a conda env\n');
    // A shared section linked into the guide, and a link leading out of the folder.
    mkdirSync(join(root, 'shared'));
    writeFileSync(join(root, 'shared', 'faq.md'), '# FAQ\n');
    symlinkSync(join(root, 'shared'), join(docs, 'faq'), 'junction');
    const elsewhere = mkdtempSync(join(tmpdir(), 'mysteditor-elsewhere-'));
    writeFileSync(join(elsewhere, 'private.md'), '# Private\n');
    symlinkSync(elsewhere, join(docs, 'private'), 'junction');
    symlinkSync(docs, join(docs, 'guide', 'loop'), 'junction'); // a link back up
    const files = await listDocuments(root);
    // The shared page is a page of the guide too, under the guide's own path.
    expect(files).toEqual(expect.arrayContaining(['docs/build/linux.md', 'docs/env/vars.md', 'docs/faq/faq.md', 'shared/faq.md']));
    expect(files.some((f) => f.includes('private') || f.startsWith('dist/') || f.startsWith('conda/'))).toBe(false);
  });

  it('skips build output', async () => {
    expect(await listDocuments(join(project(), 'docs'))).not.toContain('_build/junk.md');
  });
});

describe('resolveInside', () => {
  it('allows paths inside the base, including new files', () => {
    const base = join(project(), 'docs');
    expect(resolveInside(base, 'guide/a.md')).toBe(join(base, 'guide', 'a.md'));
    expect(resolveInside(base, 'guide/new/page.md')).toBe(join(base, 'guide', 'new', 'page.md'));
  });

  it('refuses paths and symlinks that escape the base', () => {
    const root = project();
    const base = join(root, 'docs');
    expect(() => resolveInside(base, '../outside/secret.md')).toThrow(/outside the project/);
    expect(() => resolveInside(base, '/etc/passwd')).toThrow(/outside the project/);
    symlinkSync(join(root, 'outside'), join(base, 'link'), 'junction'); // a junction needs no admin rights on Windows
    expect(() => resolveInside(base, 'link/secret.md')).toThrow(/outside the project/);
  });
});

describe('resolveForReading', () => {
  it('follows the folder’s symlinks out of it (a shared folder), but not ".." out of it', () => {
    const root = project();
    const base = join(root, 'docs');
    symlinkSync(join(root, 'outside'), join(base, 'common'), 'junction');
    expect(readFileSync(resolveForReading(base, 'common/secret.md'), 'utf8')).toBe('secret');
    expect(() => resolveForReading(base, '../outside/secret.md')).toThrow(/outside the project/);
    expect(() => resolveForReading(base, 'guide/../../outside/secret.md')).toThrow(/outside the project/);
    expect(() => resolveForReading(base, '/etc/passwd')).toThrow(/outside the project/);
  });
});

describe('firstHeading', () => {
  it('strips inline markup and roles', () => {
    expect(firstHeading('# The `widget` {term}`API <api>` and [docs](x.md)\n')).toBe('The widget API and docs');
    expect(firstHeading('No heading here\n')).toBeNull();
  });
});

describe('FolderWatcher', () => {
  const next = (seen: string[], pred: (s: string) => boolean) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`not seen; saw ${seen.join(', ')}`)), 3000);
      const check = setInterval(() => {
        if (seen.some(pred)) {
          clearTimeout(timer);
          clearInterval(check);
          resolve();
        }
      }, 20);
    });

  it('reports changes in new folders, and none from inside skipped ones', async () => {
    const root = project();
    mkdirSync(join(root, '.venv'));
    writeFileSync(join(root, '.venv', 'pyvenv.cfg'), '');
    mkdirSync(join(root, 'myenv'));
    writeFileSync(join(root, 'myenv', 'pyvenv.cfg'), '');
    const seen: string[] = [];
    const w = new FolderWatcher(root, unwatchedDir, (rel) => seen.push(rel));
    await w.start();
    try {
      writeFileSync(join(root, 'docs', 'guide', 'a.md'), '# Changed\n');
      await next(seen, (s) => s === 'docs/guide/a.md');
      mkdirSync(join(root, 'docs', 'new'));
      await next(seen, (s) => s === 'docs/new');
      // The new folder is watched once it's been noticed.
      await new Promise((r) => setTimeout(r, 100));
      writeFileSync(join(root, 'docs', 'new', 'page.md'), '# New\n');
      await next(seen, (s) => s === 'docs/new/page.md');
      writeFileSync(join(root, '.venv', 'lib.py'), '');
      writeFileSync(join(root, 'myenv', 'lib.py'), '');
      writeFileSync(join(root, 'docs', '_build', 'out.html'), '');
      rmSync(join(root, 'docs', 'new'), { recursive: true });
      await next(seen, (s) => s === 'docs/new');
      await new Promise((r) => setTimeout(r, 200));
      expect(seen.filter((s) => /venv|myenv\/|_build\//.test(s))).toEqual([]);
    } finally {
      w.close();
    }
  });
});

describe('placeImage', () => {
  it('refers to images in the folder relative to the page, and copies others in', async () => {
    const root = project();
    mkdirSync(join(root, 'docs', 'images'));
    writeFileSync(join(root, 'docs', 'images', 'in.png'), 'in');
    expect(await placeImage(root, 'docs/guide/a.md', join(root, 'docs', 'images', 'in.png'))).toBe('../images/in.png');

    const elsewhere = mkdtempSync(join(tmpdir(), 'mysteditor-pictures-'));
    writeFileSync(join(elsewhere, 'shot.png'), 'shot');
    expect(await placeImage(root, 'docs/guide/a.md', join(elsewhere, 'shot.png'))).toBe('images/shot.png');
    expect(readFileSync(join(root, 'docs', 'guide', 'images', 'shot.png'), 'utf8')).toBe('shot');
    // A second one with the same name doesn't overwrite the first.
    writeFileSync(join(elsewhere, 'shot.png'), 'newer');
    expect(await placeImage(root, 'docs/guide/a.md', join(elsewhere, 'shot.png'))).toBe('images/shot-2.png');
    expect(existsSync(join(root, 'docs', 'guide', 'images', 'shot-2.png'))).toBe(true);
  });
});

describe('saveImage', () => {
  it('saves a pasted picture next to the page under a free name, and only pictures', async () => {
    const root = project();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect(await saveImage(root, 'docs/guide/a.md', 'screenshot.png', png)).toBe('images/screenshot.png');
    expect(await saveImage(root, 'docs/guide/a.md', 'screenshot.png', png)).toBe('images/screenshot-2.png');
    expect(await saveImage(root, 'docs/guide/a.md', 'my diagram (v2).PNG', png)).toBe('images/my-diagram-v2.png');
    expect(readFileSync(join(root, 'docs', 'guide', 'images', 'screenshot-2.png'))).toEqual(Buffer.from(png));
    await expect(saveImage(root, 'docs/guide/a.md', 'notes.txt', png)).rejects.toThrow(/Not an image/);
    await expect(saveImage(root, '../outside.md', 'x.png', png)).rejects.toThrow(/outside the project/);
  });
});

describe('searchPages', () => {
  it('finds every match, line by line, ignoring case unless asked, and stops at a limit', async () => {
    const root = project();
    writeFileSync(join(root, 'docs', 'guide', 'b.md'), '# Widgets\n\nA widget, and another Widget.\n');
    const files = await listDocuments(root);
    const all = await searchPages(root, files, 'widget', false);
    expect(all.truncated).toBe(false);
    expect(all.results).toEqual([
      {
        path: 'docs/guide/b.md',
        matches: [
          { line: 1, text: '# Widgets', from: 2, to: 8 },
          { line: 3, text: 'A widget, and another Widget.', from: 2, to: 8 },
          { line: 3, text: 'A widget, and another Widget.', from: 22, to: 28 },
        ],
      },
    ]);
    expect((await searchPages(root, files, 'Widget', true)).results[0].matches.map((m) => m.line)).toEqual([1, 3]);
    expect(await searchPages(root, files, 'widget', false, 2)).toMatchObject({ truncated: true });
    expect((await searchPages(root, files, '', false)).results).toEqual([]);
  });
});
