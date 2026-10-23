// Sphinx builds for the open folder: one build manager per Sphinx project, what a
// changed file makes build again, and the window's requests about builds.
import { app, dialog, ipcMain } from 'electron';
import { join } from 'node:path';
import { SphinxManager } from './manager.js';
import { probePython } from './pythons.js';
import { isBuildInput } from '../project.js';
import type { ProjectInfo } from '../../shared/api.js';
import type { EnvironmentChoice, SphinxInfo, SphinxState } from '../../shared/sphinx.js';
import { projectFor } from '../../shared/projects.js';
import { ENV_NAME } from '../../core/editor-config.js';
import { current, requireProject, toWindow } from '../state.js';
import { loadSettings, updateSettings } from '../settings.js';

// One build manager per Sphinx project, by project id.
const sphinx = new Map<string, SphinxManager>();

// The writer's variables for the open folder (see Settings.sphinxEnv).
let userEnv: Record<string, string> = {};

// A project's variables for its builds: its settings file's, then the writer's.
function envFor(p: ProjectInfo, id: string): Record<string, string> {
  const project = p.projects.find((x) => x.id === id);
  return { ...project?.config.editor.sphinxEnv, ...userEnv };
}

// Where a project's built pages are, for the preview (see protocols.ts).
export const outputDirOf = (id: string) => sphinx.get(id)?.outputDir ?? null;

// Trust and the environment choice belong to the opened folder, so one decision
// covers all its projects (e.g. two guides sharing one .venv). `onBuilt` hears about
// every finished build.
export async function startSphinx(p: ProjectInfo, onBuilt: (p: ProjectInfo, info: SphinxInfo) => void) {
  stopSphinx();
  const settings = await loadSettings();
  userEnv = settings.sphinxEnv?.[p.root] ?? {};
  for (const sp of p.projects) {
    const manager = new SphinxManager(sp, {
      root: p.root,
      searchDirs: p.projects.map((x) => x.sourceDir),
      // Tests share one data dir so Python and packages are only downloaded once.
      dataDir: process.env.MYSTEDITOR_SPHINX_DATA ?? join(app.getPath('userData'), 'sphinx'),
      // out/main/index.js → the repository, where resources/ lives in development.
      appRoot: join(import.meta.dirname, '..', '..'),
      resourcesPath: app.isPackaged ? process.resourcesPath : null,
      trusted: !!settings.trusted?.includes(p.root),
      buildInputs: () => p.buildInputs,
      extraEnv: () => envFor(p, sp.id),
      environment: settings.environments?.[p.root] ?? null,
      emit: (state: SphinxState) => {
        toWindow('sphinx-state', { project: sp.id, state });
        if (state.info) onBuilt(p, state.info);
      },
    });
    sphinx.set(sp.id, manager);
    manager.start();
  }
}

export function stopSphinx() {
  sphinx.forEach((m) => m.dispose());
  sphinx.clear();
}

// Build these projects again from scratch (their settings changed).
export function rebuildFresh(ids: string[]) {
  ids.forEach((id) => sphinx.get(id)?.requestBuild({ fresh: true }));
}

// Files that changed while their project was building, in how many builds in a row.
// One changing during two builds is output of the build itself (an extension that
// generates pages, say), not an edit, so it doesn't start yet another build.
const changedInBuilds = new Map<string, number>();
export const forgetChangesInBuilds = () => changedInBuilds.clear();

// Build what a changed file can affect: its own project, incrementally (Sphinx works
// out what's outdated, including included files and images). Python files and data
// files are extension code and inputs Sphinx can't track, so those builds start
// afresh, and a shared one outside every project affects them all.
export function buildFor(p: ProjectInfo, rel: string, external: boolean) {
  const owner = projectFor(p.projects, rel);
  const name = rel.split('/').pop()!;
  const fresh = isBuildInput(name);
  const managers = owner ? [sphinx.get(owner.id)!].filter(Boolean) : fresh || /\.(html|jinja2?)$/.test(name) ? [...sphinx.values()] : [];
  if (external) {
    if (managers.some((m) => m.busy())) {
      const n = (changedInBuilds.get(rel) ?? 0) + 1;
      changedInBuilds.set(rel, n);
      if (n >= 2) return;
    } else changedInBuilds.delete(rel);
  }
  managers.forEach((m) => m.requestBuild({ fresh }));
}

export function registerSphinxIpc() {
  ipcMain.handle('sphinx-state', () => Object.fromEntries([...sphinx].map(([id, m]) => [id, m.getState()])));
  ipcMain.handle('sphinx-use', async (_e, choice: EnvironmentChoice) => {
    const root = requireProject().root;
    await updateSettings((s) => ({
      ...s,
      trusted: [...new Set([...(s.trusted ?? []), root])],
      environments: { ...s.environments, [root]: choice },
    }));
    sphinx.forEach((m) => m.use(choice));
  });
  // All managers of a folder search the same places, so any one can answer.
  ipcMain.handle('sphinx-candidates', () => [...sphinx.values()][0]?.candidates() ?? []);
  ipcMain.handle('sphinx-browse-python', async () => {
    const result = await dialog.showOpenDialog(current.win!, {
      title: 'Choose the Python to build the documentation with',
      defaultPath: requireProject().root,
      properties: ['openFile', 'showHiddenFiles'],
    });
    return result.canceled ? null : probePython(result.filePaths[0], 'Chosen');
  });
  ipcMain.handle('sphinx-decline', () => sphinx.forEach((m) => m.decline()));
  ipcMain.handle('sphinx-env', (_e, id: string) => ({ project: requireProject().projects.find((x) => x.id === id)?.config.editor.sphinxEnv ?? {}, yours: userEnv }));
  ipcMain.handle('sphinx-set-env', async (_e, vars: Record<string, string>) => {
    const root = requireProject().root;
    const clean = Object.fromEntries(Object.entries(vars).filter(([name, value]) => ENV_NAME.test(name) && typeof value === 'string'));
    await updateSettings((s) => ({ ...s, sphinxEnv: { ...s.sphinxEnv, [root]: clean } }));
    userEnv = clean;
    sphinx.forEach((m) => m.requestBuild({ fresh: true }));
  });
  ipcMain.handle('sphinx-rebuild', (_e, id: string) => sphinx.get(id)?.requestBuild({ fresh: true }));
  ipcMain.handle('sphinx-log', (_e, id: string) => sphinx.get(id)?.getLog() ?? '');
}
