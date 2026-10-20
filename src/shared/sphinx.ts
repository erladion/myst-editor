// Sphinx build results, shared by the main process and the renderer.

export interface SphinxDoc {
  source: string; // path relative to the source directory, e.g. "guide/install.md"
  title: string | null;
  uri: string | null; // output page, e.g. "guide/install.html"
  children: string[]; // docnames in this page's toctrees, in order
}

// A cross-reference target, from Domain.get_objects() (what objects.inv is made of).
export interface SphinxObject {
  domain: string; // "std", "py", ...
  type: string; // "label", "doc", "term", "function", ...
  name: string;
  title: string | null; // e.g. the section title of a label
  doc: string;
  anchor: string | null;
}

export type WarningPhase = 'setup' | 'read' | 'consistency' | 'write' | 'finish';

export interface SphinxWarning {
  source: string | null; // file relative to the source directory, if located
  line: number | null;
  level: 'warning' | 'error' | 'critical' | 'severe';
  message: string;
  type: string | null; // e.g. "ref.ref", "myst.directive_unknown"
  phase: WarningPhase;
}

// What mysteditor_build.py writes.
export interface BuildResult {
  ok: boolean;
  error?: string;
  sphinx_version?: string;
  root_doc?: string;
  docs?: Record<string, SphinxDoc>;
  objects?: SphinxObject[];
  warnings: SphinxWarning[];
  read_docs?: string[];
  written_docs?: string[];
  consistency_checked?: boolean;
  duration: number;
}

export interface SphinxInfo {
  sphinxVersion: string;
  rootDoc: string;
  docs: Record<string, SphinxDoc>;
  objects: SphinxObject[];
  warnings: SphinxWarning[];
  builtAt: number; // ms since epoch, also used to refresh the preview
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

export type SphinxStatus =
  | { kind: 'off' } // no project
  // Waiting for the writer to allow running Sphinx, and choose its Python.
  | { kind: 'needs-trust'; requirements: string; candidates: PythonCandidate[] }
  | { kind: 'declined' }
  | { kind: 'setting-up'; step: string }
  | { kind: 'building' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string; offline?: boolean };

export interface SphinxState {
  status: SphinxStatus;
  info: SphinxInfo | null; // from the last successful build
  // The environment in use, once chosen.
  environment: { kind: 'managed'; requirements: string } | { kind: 'existing'; python: string; pythonVersion: string; sphinx: string } | null;
}

// Combine an incremental build's warnings with the ones already known. Sphinx only
// re-reports warnings for what a build touched; see mysteditor_build.py.
export function mergeWarnings(previous: SphinxWarning[], result: BuildResult): SphinxWarning[] {
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
