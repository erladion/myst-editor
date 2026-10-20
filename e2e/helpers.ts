import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { cpSync, mkdirSync, mkdtempSync } from 'node:fs';
import { WORK_DIR } from './global-setup';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Where a test's own files go (see global-setup.ts).
export function workDir(): string {
  mkdirSync(WORK_DIR, { recursive: true });
  return WORK_DIR;
}

export interface App {
  app: ElectronApplication;
  page: Page;
  project: string; // temp copy of the fixture project
}

export interface LaunchOptions {
  fixture?: string; // folder under e2e/ to copy; default "fixture"
  env?: Record<string, string>;
  // Runs on the project copy before the app starts (e.g. to add a .venv).
  prepare?: (project: string) => void;
  // Start on the welcome screen instead of opening the project.
  noProject?: boolean;
}

// Launch the built app (`npm run build` first) on a fresh copy of the fixture project.
export async function launch(opts: LaunchOptions = {}): Promise<App> {
  const work = mkdtempSync(join(workDir(), 'mysteditor-e2e-'));
  const project = join(work, 'project');
  cpSync(join(import.meta.dirname, opts.fixture ?? 'fixture'), project, { recursive: true });
  opts.prepare?.(project);
  // Set when running inside another Electron app's Node (e.g. an editor extension host).
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  // MYSTEDITOR_EXECUTABLE runs the tests against a packaged build instead of out/.
  const packaged = process.env.MYSTEDITOR_EXECUTABLE;
  const app = await electron.launch({
    ...(packaged ? { executablePath: packaged } : {}),
    args: [...(packaged ? [] : [join(import.meta.dirname, '..', 'out', 'main', 'index.js')]), ...(opts.noProject ? [] : [project])],
    env: {
      ...env,
      MYSTEDITOR_USER_DATA: join(work, 'user-data'),
      MYSTEDITOR_SPHINX_DATA: process.env.MYSTEDITOR_SPHINX_DATA ?? join(tmpdir(), 'mysteditor-e2e-sphinx'),
      ...opts.env,
    } as Record<string, string>,
  });
  const page = await app.firstWindow();
  await page.waitForSelector(opts.noProject ? '.welcome-card' : '.prose');
  return { app, page, project };
}
