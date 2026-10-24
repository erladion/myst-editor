import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { WORK_DIR } from './global-setup';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// The folders of tests run earlier in this worker (see launch).
const earlier: string[] = [];

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
  folder?: string; // what the copy is called; default "project"
  env?: Record<string, string>;
  // Runs on the project copy before the app starts (e.g. to add a .venv).
  prepare?: (project: string) => void;
  // Start on the welcome screen instead of opening the project.
  noProject?: boolean;
  // Start again on an earlier launch's project and settings (after closing it).
  again?: App;
}

// Launch the built app (`npm run build` first) on a fresh copy of the fixture project.
export async function launch(opts: LaunchOptions = {}): Promise<App> {
  // The previous test's files go (its app is closed by now), so a run never holds
  // more than one test's projects and environments at a time.
  if (!opts.again) {
    for (const old of earlier.splice(0)) {
      try {
        // Windows can hold the closed app's files a moment longer.
        rmSync(old, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      } catch {
        // left for the global setup's cleanup
      }
    }
  }
  const work = opts.again ? dirname(opts.again.project) : mkdtempSync(join(workDir(), 'mysteditor-e2e-'));
  if (!opts.again) earlier.push(work);
  const project = opts.again ? opts.again.project : join(work, opts.folder ?? 'project');
  if (!opts.again) {
    cpSync(join(import.meta.dirname, opts.fixture ?? 'fixture'), project, { recursive: true });
    opts.prepare?.(project);
  }
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
