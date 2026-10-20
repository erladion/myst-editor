// Watching an opened folder for changes made outside the app.
//
// Node's recursive fs.watch on Linux walks and watches every file under the folder,
// synchronously, including virtualenvs, node_modules and .git, which makes opening
// a large repository slow. This watches directories only, one at a time, and never
// descends into the ones whose changes don't matter.
import { watch, promises as fs, type FSWatcher } from 'node:fs';
import { join, relative, sep } from 'node:path';

export class FolderWatcher {
  private watchers = new Map<string, FSWatcher>();
  private closed = false;
  private full = false;

  constructor(
    private root: string,
    // Directories not watched (nor anything under them).
    private skip: (parent: string, name: string) => Promise<boolean>,
    // A file or directory changed, was added or removed: its POSIX path relative to root.
    private onChange: (rel: string) => void,
  ) {}

  // Resolves once the folder's current directories are all watched.
  async start(): Promise<void> {
    await this.add(this.root);
  }

  close() {
    this.closed = true;
    this.watchers.forEach((w) => w.close());
    this.watchers.clear();
  }

  private async add(dir: string): Promise<void> {
    if (this.closed || this.full || this.watchers.has(dir)) return;
    let watcher: FSWatcher;
    try {
      watcher = watch(dir, (_event, name) => name && this.changed(dir, name.toString()));
    } catch (e) {
      // Out of inotify watches (ENOSPC): keep what's watched rather than failing.
      if ((e as NodeJS.ErrnoException).code === 'ENOSPC') {
        this.full = true;
        console.warn(`File watching stopped at ${this.watchers.size} folders: the system's inotify limit was reached.`);
      }
      return;
    }
    watcher.on('error', () => this.remove(dir));
    this.watchers.set(dir, watcher);
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && !(await this.skip(dir, e.name))) await this.add(join(dir, e.name));
    }
  }

  private remove(dir: string) {
    for (const [path, w] of this.watchers) {
      if (path === dir || path.startsWith(dir + sep)) {
        w.close();
        this.watchers.delete(path);
      }
    }
  }

  private async changed(dir: string, name: string) {
    if (this.closed) return;
    const path = join(dir, name);
    this.onChange(relative(this.root, path).split(sep).join('/'));
    // A new directory (created, or moved in) gets watched too; a removed one is dropped.
    try {
      if ((await fs.stat(path)).isDirectory() && !(await this.skip(dir, name))) await this.add(path);
    } catch {
      this.remove(path);
    }
  }
}
