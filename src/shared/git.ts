// Git state shared by the main process and the renderer.

export interface GitChange {
  path: string; // relative to the repository root
  kind: 'modified' | 'added' | 'deleted' | 'renamed' | 'conflict';
  from?: string; // renames
}

export interface GitStatus {
  branch: string | null; // null when detached
  upstream: string | null; // e.g. "origin/main"
  ahead: number;
  behind: number;
  changes: GitChange[];
}

// An earlier version of a page: one the app kept before a save, or a commit.
export type PageVersion =
  | { kind: 'saved'; id: string; date: string }
  | { kind: 'commit'; id: string; date: string; author: string; message: string; path: string };

// What the renderer knows about the opened folder's repository.
export interface GitInfo {
  available: boolean; // a `git` command was found
  repoRoot: string | null; // null if the folder isn't in a repository
  // The opened folder relative to the repository root ('' if it is the root).
  prefix: string;
  status: GitStatus | null;
  identity: { name: string; email: string } | null;
  // Half done: a rebase or merge stopped at conflicts, or set-aside edits that clashed.
  operation: GitOperation;
  // The last background check of the server: when, and why it failed if it did.
  checked: { at: number; error: string | null } | null;
}

export type GitOperation = 'rebase' | 'merge' | 'stash' | null;

// A file with conflicts to settle. `text` has git's conflict markers; null for a file
// that can only be taken whole (a picture, or one side deleted it).
export interface ConflictFile {
  path: string; // relative to the repository root
  text: string | null;
}
