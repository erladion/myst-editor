// Folders holding several Sphinx projects, like:
//   Top folder/.venv
//   Top folder/user-guide/conf.py
//   Top folder/admin-guide/conf.py
import { describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openProject } from '../src/main/project.js';
import { findPythons } from '../src/main/sphinx/pythons.js';
import { configFor, projectFor } from '../src/shared/projects.js';

function write(root: string, path: string, text: string) {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), text);
}

// A stand-in interpreter that answers the probe like a venv with Sphinx would.
function fakeVenv(dir: string, sphinx = '7.1.2') {
  write(dir, 'pyvenv.cfg', 'home = /usr/bin\n');
  write(dir, 'bin/python', `#!/bin/sh\necho '{"python": "3.9.25", "sphinx": "${sphinx}", "myst": "2.0.0"}'\n`);
  chmodSync(join(dir, 'bin', 'python'), 0o755);
}

function topFolder() {
  const root = mkdtempSync(join(tmpdir(), 'mysteditor-multi-'));
  fakeVenv(join(root, '.venv'));
  write(root, 'user-guide/conf.py', 'project = "User Guide"\nmyst_enable_extensions = ["colon_fence"]\n');
  write(root, 'user-guide/index.md', '# User guide\n');
  write(root, 'user-guide/start.md', '# Getting started\n');
  write(root, 'admin-guide/conf.py', 'project = "Admin Guide"\nextensions = ["myst_parser"]\n');
  write(root, 'admin-guide/index.md', '# Admin guide\n');
  write(root, 'README.md', '# Readme\n');
  return root;
}

describe('a folder with two Sphinx projects and a shared .venv', () => {
  it('finds both projects, each with its own MyST settings', async () => {
    const info = await openProject(topFolder());
    expect(info.projects.map((p) => [p.name, p.dir, p.confPy, p.config.extensions])).toEqual([
      ['Admin Guide', 'admin-guide', 'admin-guide/conf.py', []],
      ['User Guide', 'user-guide', 'user-guide/conf.py', ['colon_fence']],
    ]);
    expect(info.files).toEqual(['admin-guide/index.md', 'README.md', 'user-guide/index.md', 'user-guide/start.md']);
    expect(projectFor(info.projects, 'user-guide/start.md')?.name).toBe('User Guide');
    expect(projectFor(info.projects, 'README.md')).toBeNull();
    // Without colon_fence, ":::" stays text in the admin guide, as in its Sphinx build.
    expect(configFor(info, 'admin-guide/index.md').extensions).toEqual([]);
    expect(configFor(info, 'user-guide/index.md').extensions).toEqual(['colon_fence']);
  });

  // The stand-in interpreters are shell scripts, which Windows can't run as python.exe.
  it.runIf(process.platform !== 'win32')('offers the shared .venv, also when only one project folder is opened', async () => {
    const root = topFolder();
    mkdirSync(join(root, '.git'));
    const whole = await openProject(root);
    const fromTop = await findPythons(whole.root, whole.projects.map((p) => p.sourceDir));
    expect(fromTop[0]).toMatchObject({ python: join(whole.root, '.venv', 'bin', 'python'), label: 'Project .venv', sphinx: '7.1.2' });

    const one = await openProject(join(root, 'admin-guide'));
    expect(one.projects.map((p) => p.dir)).toEqual(['']);
    const fromOne = await findPythons(one.root, one.projects.map((p) => p.sourceDir));
    expect(fromOne[0]).toMatchObject({ python: join(whole.root, '.venv', 'bin', 'python'), label: 'Project ../.venv' });
  });

  it.runIf(process.platform !== 'win32')('does not search above the opened folder outside a repository', async () => {
    const root = topFolder(); // no .git anywhere above
    const one = await openProject(join(root, 'admin-guide'));
    const found = await findPythons(one.root, one.projects.map((p) => p.sourceDir));
    expect(found.some((c) => c.python.startsWith(join(root, '.venv')))).toBe(false);
  });
});

describe('project discovery', () => {
  it('ignores conf.py files that are not Sphinx configuration, and virtualenvs by any name', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mysteditor-discovery-'));
    write(root, 'docs/conf.py', 'extensions = []\n');
    write(root, 'docs/index.rst', 'Title\n=====\n');
    write(root, 'mypackage/conf.py', 'TIMEOUT = 30\n'); // a package's own settings module
    write(root, 'mypackage/notes.md', '# Notes\n');
    fakeVenv(join(root, 'docs-env'));
    write(root, 'docs-env/lib/conf.py', 'project = "x"\n');
    write(root, 'docs-env/lib/index.md', '# not docs\n');
    const info = await openProject(root);
    expect(info.projects.map((p) => p.dir)).toEqual(['docs']);
    expect(info.files).toEqual(['mypackage/notes.md']);
  });
});
