// Pythons already on this computer that could run a project's Sphinx build, for
// machines without internet access or with a hand-made documentation environment.
import { existsSync, realpathSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import type { PythonCandidate } from '../../shared/sphinx.js';
import { run } from './run.js';

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

// Usual places for a documentation environment: virtualenvs in the project, the one
// the app was started from, and the system's Python.
export async function findPythons(root: string, sourceDir: string): Promise<PythonCandidate[]> {
  const venv = (dir: string) => join(dir, 'bin', 'python');
  const places: [string, string][] = [];
  for (const dir of [sourceDir, dirname(sourceDir), root]) {
    for (const name of ['.venv', 'venv', '.env', 'env']) places.push([venv(join(dir, name)), `Project ${name}`]);
  }
  if (process.env.VIRTUAL_ENV) places.push([venv(process.env.VIRTUAL_ENV), 'Active virtual environment']);
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir) places.push([join(dir, 'python3'), `System Python (${dir})`]);
  }
  places.push(['/usr/bin/python3', 'System Python'], ['/usr/libexec/platform-python', 'System Python (platform)']);

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
      if (!/\/(\.?venv|\.?env)\//.test(c.python)) key = realpathSync(c.python);
    } catch {
      // keep the path as the key
    }
    if (!byTarget.has(key)) byTarget.set(key, c);
  }
  return [...byTarget.values()];
}
