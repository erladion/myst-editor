// Sphinx's own side of builds: what its build driver writes, and its Python.
import type { BuildPage, BuildTarget, BuildWarning } from './build.js';

// What mysteditor_build.py writes.
export interface BuildResult {
  ok: boolean;
  error?: string;
  sphinx_version?: string;
  root_doc?: string;
  docs?: Record<string, BuildPage>;
  objects?: BuildTarget[];
  warnings: BuildWarning[];
  read_docs?: string[];
  written_docs?: string[];
  consistency_checked?: boolean;
  variables?: Record<string, string>; // see variables_of
  version?: string; // conf.py's version and release
  release?: string;
  duration: number;
}

// A Python found on this computer, and what it has installed.
export interface PythonCandidate {
  python: string; // interpreter path
  label: string; // where it was found, e.g. "Project .venv", "System Python"
  pythonVersion: string;
  sphinx: string | null; // installed versions, if importable
  myst: string | null;
}

export const usable = (c: PythonCandidate) => !!c.sphinx && !!c.myst;

// How a project's builds get their Python.
export type EnvironmentChoice =
  | { kind: 'managed' } // a private environment set up by uv (needs internet the first time)
  | { kind: 'existing'; python: string }; // an interpreter that already has Sphinx

// Combine an incremental build's warnings with the ones already known. Sphinx only
// re-reports warnings for what a build touched; see mysteditor_build.py.
export function mergeWarnings(previous: BuildWarning[], result: BuildResult): BuildWarning[] {
  const docs = result.docs ?? {};
  const sources = (docnames: string[] = []) => new Set(docnames.map((d) => docs[d]?.source).filter((s): s is string => !!s));
  const read = sources(result.read_docs);
  const written = sources(result.written_docs);
  const existing = new Set(Object.values(docs).map((d) => d.source));

  const kept = previous.filter((w) => {
    if (w.phase === 'consistency') return !result.consistency_checked;
    // Per-document warnings survive while their document exists and wasn't redone.
    // Ones without a file can't be attributed, so like setup/finish warnings they
    // are replaced by every build.
    if (!w.source || !existing.has(w.source)) return false;
    if (w.phase === 'read') return !read.has(w.source);
    if (w.phase === 'write') return !written.has(w.source);
    return false;
  });
  return [...kept, ...result.warnings];
}
