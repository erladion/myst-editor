// Questions the UI asks of the latest Sphinx build.
import type { SphinxInfo, SphinxObject, SphinxWarning } from '../../shared/sphinx';
import { dirname, join } from './paths';

export function docnameOf(info: SphinxInfo, source: string): string | null {
  for (const [docname, doc] of Object.entries(info.docs)) if (doc.source === source) return docname;
  return null;
}

export function problemsIn(info: SphinxInfo | null, source: string | null): SphinxWarning[] {
  return info && source ? info.warnings.filter((w) => w.source === source) : [];
}

// A {doc} target written in `fromSource`: relative to its folder unless it starts with "/".
function docTarget(fromDoc: string | null, target: string): string | null {
  const clean = target.replace(/\.md$/, '');
  return clean.startsWith('/') ? join(clean) : join(dirname(fromDoc ?? ''), clean);
}

export interface Resolution {
  title: string | null;
  broken: boolean; // only claimed for roles whose targets the build fully knows
}

const UNKNOWN: Resolution = { title: null, broken: false };

// What a cross-reference role points at, by Sphinx's rules: labels and terms are
// case-insensitive, {doc} paths are relative to the current page.
export function resolveRole(info: SphinxInfo | null, fromSource: string | null, role: string, target: string): Resolution {
  if (!info) return UNKNOWN;
  const fromDoc = fromSource ? docnameOf(info, fromSource) : null;
  const find = (type: string, name: string) => info.objects.find((o) => o.domain === 'std' && o.type === type && o.name === name);
  switch (role) {
    case 'ref': {
      const hit = find('label', target.toLowerCase());
      return { title: hit?.title ?? null, broken: !hit };
    }
    case 'term': {
      const hit = find('term', target.toLowerCase());
      return { title: null, broken: !hit };
    }
    case 'doc': {
      const docname = docTarget(fromDoc, target);
      const doc = docname ? info.docs[docname] : undefined;
      return { title: doc?.title ?? null, broken: !doc };
    }
    default:
      return UNKNOWN;
  }
}

// `[](target)` links: MyST resolves them to a label, a page, or a URL.
export function resolveLink(info: SphinxInfo | null, fromSource: string | null, href: string): Resolution {
  if (!info || /^[a-z][\w+.-]*:/i.test(href)) return UNKNOWN;
  const target = href.replace(/^#/, '');
  const label = info.objects.find((o) => o.domain === 'std' && o.type === 'label' && o.name === target.toLowerCase());
  if (label) return { title: label.title, broken: false };
  const fromDoc = fromSource ? docnameOf(info, fromSource) : null;
  const docname = docTarget(fromDoc, target.split('#')[0]);
  const doc = docname ? info.docs[docname] : undefined;
  return doc ? { title: doc.title, broken: false } : { title: null, broken: true };
}

export interface Suggestion {
  value: string;
  label: string;
}

// Targets for a cross-reference role, for autocomplete.
export function suggestTargets(info: SphinxInfo | null, fromSource: string | null, role: string): Suggestion[] {
  if (!info) return [];
  const std = (type: string) => info.objects.filter((o: SphinxObject) => o.domain === 'std' && o.type === type);
  switch (role) {
    case 'ref':
    case 'numref':
      return std('label')
        .filter((o) => o.anchor) // skip genindex/search and other generated pages
        .map((o) => ({ value: o.name, label: o.title ? `${o.title} — ${o.doc}` : o.doc }));
    case 'term':
      return std('term').map((o) => ({ value: o.name, label: `Glossary — ${o.doc}` }));
    case 'doc': {
      // Page names are relative to the project's source directory.
      const fromDoc = fromSource ? docnameOf(info, fromSource) : null;
      const fromDir = fromDoc ? dirname(fromDoc) : '';
      return Object.entries(info.docs).map(([docname, doc]) => ({
        value: fromDir && docname.startsWith(fromDir + '/') ? docname.slice(fromDir.length + 1) : `/${docname}`,
        label: doc.title ?? docname,
      }));
    }
    default:
      return [];
  }
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
export function tocTree(info: SphinxInfo, order: Record<string, string[]> = {}): { root: TocEntry | null; orphans: TocEntry[] } {
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
