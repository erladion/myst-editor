// The PDF export from the command line (mysteditor --export-pdf), for CI: no window,
// and on Linux no display either.
import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import electronPath from 'electron';
import { workDir } from './helpers';
import { pageTexts } from './pdf-text';

// Runs the app with these options from `cwd`, without a display on Linux.
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
    env: {
      ...env,
      MYSTEDITOR_USER_DATA: join(cwd, 'user-data'),
      MYSTEDITOR_SPHINX_DATA: process.env.MYSTEDITOR_SPHINX_DATA ?? join(tmpdir(), 'mysteditor-e2e-sphinx'),
    } as Record<string, string>,
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (err += d));
  return new Promise((done) => child.on('close', (code) => done({ code, out, err })));
}

// A copy of a fixture project to work on.
function copy(fixture: string): string {
  const dir = mkdtempSync(join(workDir(), 'mysteditor-cli-'));
  cpSync(join(import.meta.dirname, fixture), join(dir, 'repo'), { recursive: true });
  return dir;
}

test.setTimeout(300_000);

test('makes the PDF of the folder with conf.py, using its settings', async () => {
  const dir = copy('fixture-showcase');
  writeFileSync(join(dir, 'repo', 'docs', '.mysteditor.toml'), '[pdf]\ntitle = "Harbor manual"\nsubtitle = "Version {version}"\n');
  const { code, out } = await run(dir, '--export-pdf', 'repo/docs', '--output', 'out/manual.pdf');
  expect(code, out).toBe(0);
  expect(out).toContain('Making a PDF of Harbor (conf.py)');
  expect(out).toMatch(/Saved 8 pages as .*manual\.pdf/);
  const text = await pageTexts(readFileSync(join(dir, 'out', 'manual.pdf')));
  expect(text[0]).toBe('Harbor manual Version 2.4');
});

test('a folder of several projects: which one, and settings layered from the folder down', async () => {
  const dir = copy('fixture-multi');
  writeFileSync(join(dir, 'repo', '.mysteditor.toml'), '[pdf]\nsubtitle = "For everyone"\n');
  const none = await run(dir, '--export-pdf', 'repo');
  expect(none.code).toBe(2);
  expect(none.err).toContain('the folder has several Sphinx projects: say which with --project.\n  admin-guide  (Admin Guide)\n  user-guide  (User Guide)');

  const { code, out } = await run(dir, '--export-pdf', 'repo', '--project', 'admin-guide');
  expect(code, out).toBe(0);
  // The default name: the project's, in the folder it was run from.
  expect(existsSync(join(dir, 'Admin Guide.pdf'))).toBe(true);
  expect((await pageTexts(readFileSync(join(dir, 'Admin Guide.pdf'))))[0]).toMatch(/For everyone$/);
});

test('the folder given may link to a shared one outside it, for its images', async () => {
  const dir = copy('fixture-showcase');
  const docs = join(dir, 'repo', 'docs');
  // repo/common, shared by the repository's projects, linked in as docs/_static.
  renameSync(join(docs, '_static'), join(dir, 'repo', 'common'));
  symlinkSync(join(dir, 'repo', 'common'), join(docs, '_static'), 'junction');
  writeFileSync(join(docs, '.mysteditor.toml'), '[pdf]\nlogo = "_static/harbor-logo.svg"\n');
  const { code, out, err } = await run(dir, '--export-pdf', 'repo/docs', '--output', 'manual.pdf');
  expect(code, out + err).toBe(0);
  expect((await pageTexts(readFileSync(join(dir, 'manual.pdf'))))[0]).toMatch(/^Harbor Harbor documentation/);
});

test('warnings are printed, and with --fail-on-warning fail it', async () => {
  const dir = copy('fixture-showcase');
  appendFileSync(join(dir, 'repo', 'docs', 'getting-started', 'install.md'), '\nSee {ref}`no-such-target`.\n');
  const { code, err } = await run(dir, '--export-pdf', 'repo/docs', '--output', 'manual.pdf', '--fail-on-warning');
  expect(code).toBe(1);
  expect(err).toMatch(/getting-started\/install\.md:\d+: warning: undefined label: 'no-such-target'/);
  expect(err).toContain('wysie: 1 warning (--fail-on-warning)');
  expect(existsSync(join(dir, 'manual.pdf'))).toBe(true); // made all the same
});

test('a mistake in the options is explained', async () => {
  const { code, err } = await run(workDir(), '--export-pdf', 'docs', '--ouput', 'a.pdf');
  expect(code).toBe(2);
  expect(err).toContain('wysie: unknown option --ouput');
  expect(err).toContain('Usage: wysie --export-pdf <folder> [options]');
});
