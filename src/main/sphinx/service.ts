// Sphinx's builders for the open folder's Sphinx projects, and the window's requests
// about them: trusting the folder, its Python environment, its variables.
import { app, dialog, ipcMain } from 'electron';
import { join } from 'node:path';
import { SphinxManager } from './manager.js';
import { probePython } from './pythons.js';
import type { ProjectInfo } from '../../shared/api.js';
import type { EnvironmentChoice } from '../../shared/sphinx.js';
import type { BuildInfo, BuildState } from '../../shared/build.js';
import { ENV_NAME } from '../../core/editor-config.js';
import { current, requireProject } from '../state.js';
import { allBuilders, builderOf } from '../builders/service.js';
import type { Builder, BuilderFactory } from '../builders/builder.js';
import { loadSettings, updateSettings } from '../settings.js';

// The Sphinx builders, of the folder's Sphinx projects.
const sphinxManagers = () => allBuilders().filter((b): b is SphinxManager => b instanceof SphinxManager);

// The writer's variables for the open folder (see Settings.sphinxEnv).
let userEnv: Record<string, string> = {};

// A project's variables for its builds: its settings file's, then the writer's.
function envFor(p: ProjectInfo, id: string): Record<string, string> {
  const project = p.projects.find((x) => x.id === id);
  return { ...project?.config.editor.sphinxEnv, ...userEnv };
}

// A Sphinx project's builder (for its PDF, which Sphinx builds too).
export const managerOf = (id: string) => {
  const b = builderOf(id);
  return b instanceof SphinxManager ? b : null;
};

// Where managers keep environments and builds, and find the build driver and uv.
export const managerPaths = () => ({
  // Tests share one data dir so Python and packages are only downloaded once.
  dataDir: process.env.MYSTEDITOR_SPHINX_DATA ?? join(app.getPath('userData'), 'sphinx'),
  // out/main/index.js → the repository, where resources/ lives in development.
  appRoot: join(import.meta.dirname, '..', '..'),
  resourcesPath: app.isPackaged ? process.resourcesPath : null,
});

// Trust and the environment choice belong to the opened folder, so one decision
// covers all its projects (e.g. two guides sharing one .venv).
export const sphinxBuilders: BuilderFactory = async (p, projects, emit) => {
  const settings = await loadSettings();
  userEnv = settings.sphinxEnv?.[p.root] ?? {};
  const made = new Map<string, Builder>();
  for (const sp of projects) {
    made.set(
      sp.id,
      new SphinxManager(sp, {
        root: p.root,
        searchDirs: projects.map((x) => x.sourceDir),
        ...managerPaths(),
        trusted: !!settings.trusted?.includes(p.root),
        buildInputs: () => p.buildInputs,
        extraEnv: () => envFor(p, sp.id),
        environment: settings.environments?.[p.root] ?? null,
        emit: (state) => emit(sp, state),
      }),
    );
  }
  return made;
};

export function registerSphinxIpc() {
  ipcMain.handle('sphinx-use', async (_e, choice: EnvironmentChoice) => {
    const root = requireProject().root;
    await updateSettings((s) => ({
      ...s,
      trusted: [...new Set([...(s.trusted ?? []), root])],
      environments: { ...s.environments, [root]: choice },
    }));
    sphinxManagers().forEach((m) => m.use(choice));
  });
  // All managers of a folder search the same places, so any one can answer.
  ipcMain.handle('sphinx-candidates', () => sphinxManagers()[0]?.candidates() ?? []);
  ipcMain.handle('sphinx-browse-python', async () => {
    const result = await dialog.showOpenDialog(current.win!, {
      title: 'Choose the Python to build the documentation with',
      defaultPath: requireProject().root,
      properties: ['openFile', 'showHiddenFiles'],
    });
    return result.canceled ? null : probePython(result.filePaths[0], 'Chosen');
  });
  ipcMain.handle('sphinx-decline', () => sphinxManagers().forEach((m) => m.decline()));
  ipcMain.handle('sphinx-env', (_e, id: string) => ({ project: requireProject().projects.find((x) => x.id === id)?.config.editor.sphinxEnv ?? {}, yours: userEnv }));
  ipcMain.handle('sphinx-set-env', async (_e, vars: Record<string, string>) => {
    const root = requireProject().root;
    const clean = Object.fromEntries(Object.entries(vars).filter(([name, value]) => ENV_NAME.test(name) && typeof value === 'string'));
    await updateSettings((s) => ({ ...s, sphinxEnv: { ...s.sphinxEnv, [root]: clean } }));
    userEnv = clean;
    sphinxManagers().forEach((m) => m.requestBuild({ fresh: true }));
  });
}
