// Runs the real build pipeline (uv, Sphinx) on the e2e fixture project. Needs network
// access the first time, to download Python and the docs packages.
import { describe, expect, it } from 'vitest';
import { appendFileSync, cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openProject } from '../../src/main/project.js';
import { SphinxManager } from '../../src/main/sphinx/manager.js';
import type { SphinxState } from '../../src/shared/sphinx.js';

const repo = join(import.meta.dirname, '..', '..');

async function setUp() {
  const work = mkdtempSync(join(tmpdir(), 'mysteditor-sphinx-'));
  cpSync(join(repo, 'e2e', 'fixture'), join(work, 'project'), { recursive: true });
  const project = await openProject(join(work, 'project'));
  const states: SphinxState[] = [];
  let notify = () => {};
  const manager = new SphinxManager(project.projects[0], {
    root: project.root,
    searchDirs: project.projects.map((x) => x.sourceDir),
    // A shared data dir keeps the downloaded Python and packages between runs.
    dataDir: process.env.MYSTEDITOR_TEST_DATA ?? join(tmpdir(), 'mysteditor-sphinx-data'),
    appRoot: repo,
    resourcesPath: null,
    trusted: true,
    environment: null,
    emit: (s) => {
      states.push(s);
      notify();
    },
  });
  const until = (pred: (s: SphinxState) => boolean, after = 0) =>
    new Promise<SphinxState>((resolve, reject) => {
      const check = () => {
        const hit = states.slice(after).find(pred);
        const failed = states.slice(after).find((s) => s.status.kind === 'error');
        if (hit) resolve(hit);
        else if (failed) reject(new Error((failed.status as { message: string }).message));
      };
      notify = check;
      check();
    });
  return { manager, project, states, until, docs: join(work, 'project', 'docs') };
}

describe('SphinxManager', () => {
  it('sets up an environment, builds, and merges incremental warnings', async () => {
    const { manager, states, until, docs } = await setUp();
    manager.start();
    const first = await until((s) => s.status.kind === 'ready');
    const info = first.info!;
    expect(info.rootDoc).toBe('index');
    expect(info.docs.index.children).toEqual(['guide/install', 'guide/configure']);
    expect(info.docs['guide/install']).toMatchObject({ title: 'Installing Widget', source: 'docs/guide/install.md' });
    expect(info.objects).toContainEqual(expect.objectContaining({ type: 'label', name: 'configuration', title: 'Configuration', doc: 'guide/install' }));
    expect(info.warnings.map((w) => [w.source, w.line, w.type])).toEqual([['docs/index.md', 47, 'myst.directive_unknown']]);
    expect(states.some((s) => s.status.kind === 'setting-up')).toBe(true);

    // Break a reference in another page: the incremental build only touches that
    // page, but the earlier warning must survive.
    appendFileSync(join(docs, 'guide', 'configure.md'), '\nSee {ref}`no-such-label`.\n');
    const mark = states.length;
    manager.requestBuild();
    const second = await until((s) => s.status.kind === 'ready', mark);
    expect(second.info!.warnings.map((w) => [w.source, w.type]).sort()).toEqual([
      ['docs/guide/configure.md', 'ref.ref'],
      ['docs/index.md', 'myst.directive_unknown'],
    ]);
    manager.dispose();
  });

  it('asks before running anything for an untrusted project', async () => {
    const { project } = await setUp();
    let state: SphinxState | null = null;
    const manager = new SphinxManager(project.projects[0], {
    root: project.root,
    searchDirs: project.projects.map((x) => x.sourceDir), dataDir: join(tmpdir(), 'unused'), appRoot: repo, resourcesPath: null, trusted: false, environment: null, emit: (s) => (state = s) });
    manager.start();
    await new Promise((r) => setTimeout(r, 3000)); // finding Pythons on this computer
    expect(state).toMatchObject({ status: { kind: 'needs-trust', requirements: 'docs/requirements.txt' }, info: null });
    manager.dispose();
  });
});
