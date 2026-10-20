// Pythons already on this computer that could run a project's Sphinx build, for
// machines without internet access or with a hand-made documentation environment.
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { delimiter, dirname, join, relative, sep } from 'node:path';
import type { PythonCandidate } from '../../shared/sphinx.js';
import { run } from './run.js';
import { venvPython as venv } from './environment.js';

const PROBE = `
import json, sys
info = {"python": sys.version.split()[0], "sphinx": None, "myst": None}
try:
    import sphinx; info["sphinx"] = sphinx.__version__
except Exception: pass
try:
    import myst_parser; info["myst"] = myst_parser.__version__
except Exception: pass
print(json.dumps(info))
`;

// Environment for running a Python that isn't ours: as the user has it, minus
// variables meant for Electron.
export function existingEnv(): NodeJS.ProcessEnv {
  return { ...process.env, ELECTRON_RUN_AS_NODE: undefined, PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1' };
}

// Ask an interpreter what it has. Null if it isn't a working Python.
export async function probePython(python: string, label: string): Promise<PythonCandidate | null> {
  try {
    // Same environment as builds get (see existingEnv), so user site-packages and
    // PYTHONPATH count, as they would for the build.
    const { code, output } = await run(python, ['-c', PROBE], { timeoutMs: 15_000, env: existingEnv() });
    if (code !== 0) return null;
    const info = JSON.parse(output.trim().split('\n').pop() ?? '');
    return { python, label, pythonVersion: info.python, sphinx: info.sphinx, myst: info.myst };
  } catch {
    return null;
  }
}

// Folders to look for virtualenvs in, nearest first: each project's source directory
// up to the opened folder, then on up to the repository root (where .git is), so a
// shared .venv is found even when only one project's folder was opened.
function searchDirs(root: string, sourceDirs: string[]): string[] {
  const dirs: string[] = [];
  const add = (d: string) => !dirs.includes(d) && dirs.push(d);
  for (const start of [...sourceDirs, root]) {
    for (let d = start; d.startsWith(root); d = dirname(d)) {
      add(d);
      if (d === root || dirname(d) === d) break;
    }
  }
  // Above the opened folder only within its repository, never into unrelated
  // folders like the home directory.
  const above: string[] = [];
  for (let d = root; !existsSync(join(d, '.git')); ) {
    if (dirname(d) === d || above.length >= 6) return dirs;
    d = dirname(d);
    above.push(d);
  }
  above.forEach(add);
  return dirs;
}

// Where Python is usually installed on Windows: python.org's installers (for one user
// or everyone) and PATH, which includes the Microsoft Store's python.exe if installed.
function windowsPythons(): [string, string][] {
  const places: [string, string][] = [];
  const installs = [
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'Python'),
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
  ];
  for (const base of installs) {
    if (!base) continue;
    try {
      for (const name of readdirSync(base)) if (/^Python3\d+/i.test(name)) places.push([join(base, name, 'python.exe'), `Python (${name})`]);
    } catch {
      // not there
    }
  }
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir) places.push([join(dir, 'python.exe'), `System Python (${dir})`]);
  }
  return places;
}

// Usual places for a documentation environment: virtualenvs in or above the projects,
// the one the app was started from, and the system's Python.
export async function findPythons(root: string, sourceDirs: string[]): Promise<PythonCandidate[]> {
  const places: [string, string][] = [];
  for (const dir of searchDirs(root, sourceDirs)) {
    const where = relative(root, dir).split(sep).join('/');
    for (const name of ['.venv', 'venv', '.env', 'env']) {
      places.push([venv(join(dir, name)), `Project ${where ? `${where}/` : ''}${name}`]);
    }
  }
  if (process.env.VIRTUAL_ENV) places.push([venv(process.env.VIRTUAL_ENV), 'Active virtual environment']);
  if (process.platform === 'win32') places.push(...windowsPythons());
  else {
    for (const dir of (process.env.PATH ?? '').split(delimiter)) {
      if (dir) places.push([join(dir, 'python3'), `System Python (${dir})`]);
    }
    places.push(['/usr/bin/python3', 'System Python'], ['/usr/libexec/platform-python', 'System Python (platform)']);
  }

  // A venv's bin/python is a symlink to its base interpreter, so dedupe on the path
  // itself, not the resolved target; just skip ones that don't exist.
  const seen = new Set<string>();
  const unique = places.filter(([path]) => {
    if (seen.has(path) || !existsSync(path)) return false;
    seen.add(path);
    return true;
  });
  const found = await Promise.all(unique.map(([path, label]) => probePython(path, label)));
  // Different PATH entries often point at the same interpreter (e.g. /bin → /usr/bin).
  const byTarget = new Map<string, PythonCandidate>();
  for (const c of found) {
    if (!c) continue;
    let key = c.python;
    try {
      if (!/[\\/](\.?venv|\.?env)[\\/]/.test(c.python)) key = realpathSync(c.python);
    } catch {
      // keep the path as the key
    }
    if (!byTarget.has(key)) byTarget.set(key, c);
  }
  return [...byTarget.values()];
}
