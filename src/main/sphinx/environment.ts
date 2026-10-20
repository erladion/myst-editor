// A private Python environment per project, created and kept up to date with uv.
import { createHash } from 'node:crypto';
import { existsSync, promises as fs, readdirSync, readFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { runChecked, run, type RunOptions } from './run.js';
import { planEnvironment, type EnvPlan } from './discover.js';

export interface EnvPaths {
  dataDir: string; // shared: uv cache and uv-managed Python installs
  envDir: string; // this project's virtual environment
}

// Bump to force every environment to be rebuilt (e.g. after changing what gets installed).
const ENV_FORMAT = 1;
const MARKER = '.mysteditor-env.json';

// The uv binary: bundled with the app, fetched into resources/ for development, or on PATH.
export function findUv(resourcesPath: string | null, appRoot: string): string | null {
  const candidates = [
    process.env.MYSTEDITOR_UV,
    resourcesPath && join(resourcesPath, 'uv', 'uv'),
    join(appRoot, 'resources', 'uv', 'uv'),
    ...(process.env.PATH ?? '').split(delimiter).map((d) => d && join(d, 'uv')),
  ];
  return candidates.find((c): c is string => !!c && existsSync(c)) ?? null;
}

export function uvEnv(paths: EnvPaths): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // Keep uv's downloads with the app, and never pick up a system Python for a
    // managed environment (distro Pythons vary; RHEL 9's 3.9 can't run current
    // Sphinx). Existing environments are a separate, explicit choice.
    UV_CACHE_DIR: process.env.UV_CACHE_DIR ?? join(paths.dataDir, 'uv-cache'),
    UV_PYTHON_INSTALL_DIR: process.env.UV_PYTHON_INSTALL_DIR ?? join(paths.dataDir, 'python'),
    UV_PYTHON_PREFERENCE: 'only-managed',
    UV_NO_PROGRESS: '1',
    // Give up quickly on a network that isn't there.
    UV_HTTP_CONNECT_TIMEOUT: process.env.UV_HTTP_CONNECT_TIMEOUT ?? '10',
    UV_HTTP_RETRIES: process.env.UV_HTTP_RETRIES ?? '1',
    VIRTUAL_ENV: undefined,
    PYTHONHOME: undefined,
  };
}

export function envPython(envDir: string): string {
  return join(envDir, 'bin', 'python');
}

// A fingerprint of everything that decides the environment's contents.
function fingerprint(plan: EnvPlan): string {
  const hash = createHash('sha256').update(JSON.stringify({ ENV_FORMAT, plan }));
  for (const file of plan.requirements) hash.update(readFileSync(file));
  for (const { path } of plan.editable) {
    const pyproject = join(path, 'pyproject.toml');
    if (existsSync(pyproject)) hash.update(readFileSync(pyproject));
  }
  return hash.digest('hex');
}

// Whether the environment matches the plan already, so nothing needs installing.
export async function environmentIsCurrent(plan: EnvPlan, paths: EnvPaths): Promise<boolean> {
  try {
    const marker = JSON.parse(await fs.readFile(join(paths.envDir, MARKER), 'utf8'));
    return marker.fingerprint === fingerprint(plan) && existsSync(envPython(paths.envDir));
  } catch {
    return false;
  }
}

// Whether uv has downloaded any Python yet (otherwise setup needs to download one).
export function hasManagedPython(paths: EnvPaths): boolean {
  try {
    return readdirSync(process.env.UV_PYTHON_INSTALL_DIR ?? join(paths.dataDir, 'python')).some((d) => d.startsWith('cpython-'));
  } catch {
    return false;
  }
}

export async function ensureEnvironment(
  uv: string,
  root: string,
  sourceDir: string,
  paths: EnvPaths,
  onStep: (step: string) => void,
  opts: RunOptions,
): Promise<{ python: string; plan: EnvPlan }> {
  const plan = planEnvironment(root, sourceDir);
  const print = fingerprint(plan);
  const python = envPython(paths.envDir);
  const markerPath = join(paths.envDir, MARKER);
  if (await environmentIsCurrent(plan, paths)) return { python, plan };

  const env = uvEnv(paths);
  const runOpts = { ...opts, cwd: root, env };
  onStep(`Preparing Python ${plan.python}`);
  await runChecked(uv, ['venv', '--clear', '--python', plan.python, paths.envDir], runOpts);

  const args = ['pip', 'install', '--python', python];
  for (const r of plan.requirements) args.push('-r', r);
  for (const e of plan.editable) args.push('-e', e.extras.length ? `${e.path}[${e.extras.join(',')}]` : e.path);
  args.push(...plan.packages);
  onStep(`Installing documentation packages (${plan.description})`);
  await runChecked(uv, args, runOpts);

  // Requirements files don't always list Sphinx and MyST-Parser themselves.
  const check = await run(python, ['-c', 'import sphinx, myst_parser'], runOpts);
  if (check.code !== 0) {
    onStep('Installing Sphinx and MyST-Parser');
    await runChecked(uv, ['pip', 'install', '--python', python, 'sphinx', 'myst-parser'], runOpts);
  }

  await fs.writeFile(markerPath, JSON.stringify({ fingerprint: print, plan, created: new Date().toISOString() }, null, 2));
  return { python, plan };
}
