// Builds of a project's pages (by Sphinx, or another builder), shared by the main
// process and the renderer.
import type { PythonCandidate } from './sphinx.js';

export interface BuildPage {
  source: string; // path relative to the source directory, e.g. "guide/install.md"
  title: string | null;
  uri: string | null; // output page, e.g. "guide/install.html"
  children: string[]; // docnames in this page's toctrees, in order
}

// A cross-reference target, from Domain.get_objects() (what objects.inv is made of).
export interface BuildTarget {
  domain: string; // "std", "py", ...
  type: string; // "label", "doc", "term", "function", ...
  name: string;
  title: string | null; // e.g. the section title of a label
  doc: string;
  anchor: string | null;
}

export type WarningPhase = 'setup' | 'read' | 'consistency' | 'write' | 'finish';

export interface BuildWarning {
  source: string | null; // file relative to the source directory, if located
  line: number | null;
  level: 'warning' | 'error' | 'critical' | 'severe';
  message: string;
  type: string | null; // e.g. "ref.ref", "myst.directive_unknown"
  phase: WarningPhase;
}

export interface BuildInfo {
  sphinxVersion: string;
  rootDoc: string;
  docs: Record<string, BuildPage>;
  objects: BuildTarget[];
  warnings: BuildWarning[];
  builtAt: number; // ms since epoch, also used to refresh the preview
  duration: number;
  // What the PDF can show as {name}: author, copyright and html_context, from conf.py.
  variables: Record<string, string>;
}

export type BuildStatus =
  | { kind: 'off' } // no project
  // Waiting for the writer to allow running Sphinx, and choose its Python.
  | { kind: 'needs-trust'; requirements: string; candidates: PythonCandidate[] }
  | { kind: 'declined' }
  | { kind: 'setting-up'; step: string }
  | { kind: 'building' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string; offline?: boolean };

export interface BuildState {
  status: BuildStatus;
  info: BuildInfo | null; // from the last successful build
  // The environment in use, once chosen.
  environment: { kind: 'managed'; requirements: string } | { kind: 'existing'; python: string; pythonVersion: string; sphinx: string } | null;
}

