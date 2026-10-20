// The app's own earlier versions of pages ("snapshots"), kept outside the project.
//
// Autosave writes every change straight away, so without these a paragraph deleted
// by mistake would be gone as soon as it's saved (git only has what was committed).
// Before a save, the page as it was on disk is kept, at most once per SPACING, so a
// session of editing leaves a version from before it, and one about every so often.
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

const SPACING_MS = 10 * 60_000;
const KEEP = 50; // per page
const MAX_AGE_MS = 30 * 24 * 3600_000;

export interface Snapshot {
  id: string; // when it was taken, in ms
  date: string; // ISO 8601
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 20);

export class Snapshots {
  constructor(
    private baseDir: string, // e.g. <userData>/history
    private now = () => Date.now(),
  ) {}

  private dir(root: string, rel: string) {
    return join(this.baseDir, hash(root), hash(rel));
  }

  async list(root: string, rel: string): Promise<Snapshot[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.dir(root, rel));
    } catch {
      return [];
    }
    return names
      .filter((n) => /^\d+\.md$/.test(n))
      .map((n) => Number(n.slice(0, -3)))
      .sort((a, b) => b - a)
      .map((t) => ({ id: String(t), date: new Date(t).toISOString() }));
  }

  async read(root: string, rel: string, id: string): Promise<string | null> {
    if (!/^\d+$/.test(id)) return null;
    try {
      return await fs.readFile(join(this.dir(root, rel), `${id}.md`), 'utf8');
    } catch {
      return null;
    }
  }

  // Keep `text` as a version of the page, unless one was kept less than SPACING ago
  // (`force` keeps it anyway: before restoring an older version) or it's the same as
  // the last one.
  async keep(root: string, rel: string, text: string, { force = false } = {}): Promise<boolean> {
    const existing = await this.list(root, rel);
    const latest = existing[0];
    if (latest && !force && this.now() - Number(latest.id) < SPACING_MS) return false;
    if (latest && (await this.read(root, rel, latest.id)) === text) return false;
    const dir = this.dir(root, rel);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, `${this.now()}.md`), text);
    // Which page this is, for anyone looking in the folder.
    await fs.writeFile(join(dir, 'page.txt'), `${root}\n${rel}\n`);
    // Old ones go: beyond the newest KEEP, and anything past MAX_AGE.
    for (const [i, s] of [{ id: String(this.now()) }, ...existing].entries()) {
      if (i >= KEEP || this.now() - Number(s.id) > MAX_AGE_MS) await fs.rm(join(dir, `${s.id}.md`), { force: true });
    }
    return true;
  }
}
