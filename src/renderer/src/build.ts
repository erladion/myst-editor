// Questions the UI asks of a project's latest build (see builders/ for those that
// depend on its builder's rules).
import type { BuildInfo, BuildWarning } from '../../shared/build';

export function docnameOf(info: BuildInfo, source: string): string | null {
  for (const [docname, doc] of Object.entries(info.docs)) if (doc.source === source) return docname;
  return null;
}

export function problemsIn(info: BuildInfo | null, source: string | null): BuildWarning[] {
  return info && source ? info.warnings.filter((w) => w.source === source) : [];
}

// What a cross-reference points at, as far as the build knows.
export interface Resolution {
  title: string | null;
  broken: boolean; // only claimed for roles whose targets the build fully knows
}

export interface Suggestion {
  value: string;
  label: string;
}

export interface TocEntry {
  docname: string;
  source: string;
  title: string;
  children: TocEntry[];
  parent: string | null; // the page whose table of contents lists it; null at the top or outside
}

// The page hierarchy from the root document's toctrees, and pages not in it.
// `order` replaces some pages' children (a move that the next build will confirm).
export function tocTree(info: BuildInfo, order: Record<string, string[]> = {}): { root: TocEntry | null; orphans: TocEntry[] } {
  const seen = new Set<string>();
  const entry = (docname: string, parent: string | null): TocEntry | null => {
    const doc = info.docs[docname];
    if (!doc || seen.has(docname)) return null;
    seen.add(docname);
    return {
      docname,
      source: doc.source,
      title: doc.title ?? docname,
      parent,
      children: (order[docname] ?? doc.children).map((c) => entry(c, docname)).filter((e): e is TocEntry => !!e),
    };
  };
  const root = entry(info.rootDoc, null);
  const orphans = Object.keys(info.docs)
    .filter((d) => !seen.has(d))
    .sort()
    .map((d) => ({ docname: d, source: info.docs[d].source, title: info.docs[d].title ?? d, children: [], parent: null }));
  return { root, orphans };
}
