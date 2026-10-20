// Existing Python environments and offline behaviour, with real interpreters.
import { describe, expect, it } from 'vitest';
import { venvPython } from '../../src/main/sphinx/environment.js';
import { cpSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openProject } from '../../src/main/project.js';
import { SphinxManager } from '../../src/main/sphinx/manager.js';
import { findPythons } from '../../src/main/sphinx/pythons.js';
import type { EnvironmentChoice, SphinxState } from '../../src/shared/sphinx.js';

const repo = join(import.meta.dirname, '..', '..');
const shared = process.env.MYSTEDITOR_TEST_DATA ?? join(tmpdir(), 'mysteditor-sphinx-data');
const uv = join(repo, 'resources', 'uv', process.platform === 'win32' ? 'uv.exe' : 'uv');
const uvEnv = { ...process.env, UV_CACHE_DIR: join(shared, 'uv-cache'), UV_PYTHON_INSTALL_DIR: join(shared, 'python'), UV_PYTHON_PREFERENCE: 'only-managed' };

// A copy of the fixture, optionally with a .venv made by hand (as an admin might).
async function project(venvPackages?: string[]) {
  const work = mkdtempSync(join(tmpdir(), 'mysteditor-env-'));
  const root = join(work, 'project');
  cpSync(join(repo, 'e2e', 'fixture'), root, { recursive: true });
  if (venvPackages) {
    execFileSync(uv, ['venv', '-q', '--python', '3.12', join(root, '.venv')], { env: uvEnv });
    if (venvPackages.length) execFileSync(uv, ['pip', 'install', '-q', '--python', venvPython(join(root, '.venv')), ...venvPackages], { env: uvEnv });
  }
  return { root, work, info: await openProject(root) };
}

function manager(info: Awaited<ReturnType<typeof openProject>>, dataDir: string, environment: EnvironmentChoice) {
  const states: SphinxState[] = [];
  let notify = () => {};
  const m = new SphinxManager(info.projects[0], {
    root: info.root,
    searchDirs: info.projects.map((x) => x.sourceDir),
    buildInputs: () => info.buildInputs,
    dataDir,
    appRoot: repo,
    resourcesPath: null,
    trusted: true,
    environment,
    emit: (s) => {
      states.push(s);
      notify();
    },
  });
  const settled = () =>
    new Promise<SphinxState>((resolve) => {
      const check = () => {
        const last = states[states.length - 1];
        if (last && (last.status.kind === 'ready' || last.status.kind === 'error')) resolve(last);
      };
      notify = check;
      check();
    });
  return { m, settled };
}

describe('existing environments', () => {
  it('finds a project .venv with Sphinx and builds with it, without uv', async () => {
    const { root, work, info } = await project(['sphinx', 'myst-parser', 'sphinx-design', 'furo']);
    const python = venvPython(join(root, '.venv'));
    const found = await findPythons(info.root, info.projects.map((x) => x.sourceDir));
    expect(found[0]).toMatchObject({ python, label: 'Project .venv' });
    expect(found[0].sphinx).toMatch(/^\d/);

    const { m, settled } = manager(info, join(work, 'data'), { kind: 'existing', python });
    m.start();
    const state = await settled();
    expect(state.status.kind).toBe('ready');
    expect(state.environment).toMatchObject({ kind: 'existing', python });
    expect(state.info!.docs['guide/install'].title).toBe('Installing Widget');
    expect(m.getLog()).not.toMatch(/\buv (venv|pip)\b/);
    m.dispose();
  });

  it('explains what is missing from an environment without Sphinx', async () => {
    const { root, work, info } = await project([]);
    const { m, settled } = manager(info, join(work, 'data'), { kind: 'existing', python: venvPython(join(root, '.venv')) });
    m.start();
    const state = await settled();
    expect(state.status).toMatchObject({ kind: 'error' });
    expect((state.status as { message: string }).message).toMatch(/doesn’t have Sphinx and MyST-Parser installed/);
    m.dispose();
  });
});

describe('offline', () => {
  it('fails fast with a clear message when the private environment needs downloading', async () => {
    const { work, info } = await project();
    process.env.UV_OFFLINE = '1';
    try {
      const started = Date.now();
      const { m, settled } = manager(info, join(work, 'empty-data'), { kind: 'managed' });
      m.start();
      const state = await settled();
      expect(state.status).toMatchObject({ kind: 'error', offline: true });
      expect((state.status as { message: string }).message).toMatch(/can’t reach the internet/);
      expect(Date.now() - started).toBeLessThan(5000);
      m.dispose();
    } finally {
      delete process.env.UV_OFFLINE;
    }
  });
});
