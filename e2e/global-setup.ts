// Test projects and repositories live under one folder, cleared before and after a
// run, so repeated runs don't fill the temporary directory.
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const WORK_DIR = join(tmpdir(), 'mysteditor-e2e-work');

export default function setup() {
  rmSync(WORK_DIR, { recursive: true, force: true });
  // Environments and builds earlier runs left in the shared Sphinx data folder: each
  // run's projects are new folders, so new environments (the downloads are kept).
  const data = process.env.MYSTEDITOR_SPHINX_DATA ?? join(tmpdir(), 'mysteditor-e2e-sphinx');
  for (const sub of ['envs', 'builds', 'logs']) rmSync(join(data, sub), { recursive: true, force: true });
  return () => rmSync(WORK_DIR, { recursive: true, force: true });
}
