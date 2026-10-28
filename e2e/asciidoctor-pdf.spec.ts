// A PDF of an Asciidoctor project, from the command line: the book's main document
// with its chapters, laid out as a Sphinx project's is (cover, contents, chapters).
import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import electronPath from 'electron';
import { workDir } from './helpers';
import { pageTexts } from './pdf-text';

function run(cwd: string, ...args: string[]): Promise<{ code: number | null; out: string; err: string }> {
  const packaged = process.env.MYSTEDITOR_EXECUTABLE;
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const linux = process.platform === 'linux' ? ['--ozone-platform=headless'] : [];
  if (linux.length) {
    delete env.DISPLAY;
    delete env.WAYLAND_DISPLAY;
  }
  const child = spawn(packaged ?? (electronPath as unknown as string), [...linux, ...(packaged ? [] : [join(import.meta.dirname, '..', 'out', 'main', 'index.js')]), ...args], {
    cwd,
    env: { ...env, MYSTEDITOR_USER_DATA: join(cwd, 'user-data'), MYSTEDITOR_SPHINX_DATA: join(tmpdir(), 'mysteditor-e2e-sphinx') } as Record<string, string>,
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (err += d));
  return new Promise((done) => child.on('close', (code) => done({ code, out, err })));
}

test.setTimeout(120_000);

test('makes the PDF of a book: its cover, contents and chapters', async () => {
  const dir = mkdtempSync(join(workDir(), 'mysteditor-adoc-pdf-'));
  cpSync(join(import.meta.dirname, 'fixture-adoc-book'), join(dir, 'book'), { recursive: true });
  writeFileSync(join(dir, 'book', '.mysteditor.toml'), '[pdf]\nsubtitle = "For {product}"\n');
  const { code, out, err } = await run(dir, '--export-pdf', 'book', '--output', 'book.pdf');
  expect(code, `${out}\n${err}`).toBe(0);
  expect(out).toContain('Making a PDF of Widget Book (index.adoc)');
  expect(out).toContain('Building the pages with Asciidoctor…');
  // The broken cross-reference's anchor isn't there: a warning, but a PDF all the same.
  const text = await pageTexts(readFileSync(join(dir, 'book.pdf')));
  expect(text[0]).toBe('Widget Book For Widget');
  const contents = text.find((t) => /Contents/.test(t))!;
  expect(contents).toMatch(/Installing\s*\.*\s*1/);
  expect(contents).toMatch(/Using\s*\.*\s*\d/);
  // Each chapter from a page of its own, with its text and the book's attributes.
  expect(text.some((t) => /^Installing/.test(t) && t.includes('You need a computer.'))).toBe(true);
  expect(text.some((t) => /^Using/.test(t))).toBe(true);
});
