// Every test run keeps its temporary files in one folder, removed when it ends, and
// clears the environments and builds earlier runs left in the shared Sphinx data
// folder (the downloads, uv's cache and Python, are kept). Without this, temp folders
// and per-project environments pile up run after run until the disk runs out of room.
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function pruneSphinxData(dir: string) {
  for (const sub of ['envs', 'builds', 'logs']) rmSync(join(dir, sub), { recursive: true, force: true });
}

export default function setup() {
  const system = tmpdir();
  process.env.MYSTEDITOR_TEST_DATA ??= join(system, 'mysteditor-sphinx-data');
  pruneSphinxData(process.env.MYSTEDITOR_TEST_DATA);
  const run = join(system, `mysteditor-tests-${process.pid}`);
  mkdirSync(run, { recursive: true });
  // os.tmpdir() reads these (TMPDIR on Linux and macOS, TEMP/TMP on Windows); the test
  // workers start after this, with them set.
  process.env.TMPDIR = process.env.TEMP = process.env.TMP = run;
  return () => rmSync(run, { recursive: true, force: true });
}
