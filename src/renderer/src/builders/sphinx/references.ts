// Sphinx's cross-references: what roles and links point at, by Sphinx's rules, and
// the targets a role can have, from the last build.
import type { BuildInfo, BuildTarget } from '../../../../shared/build';
import { dirname, join } from '../../paths';
import { docnameOf, type Resolution, type Suggestion } from '../../build';
import type { References } from '../builder';

// A {doc} target written in `fromSource`: relative to its folder unless it starts with "/".
function docTarget(fromDoc: string | null, target: string): string | null {
  const clean = target.replace(/\.md$/, '');
  return clean.startsWith('/') ? join(clean) : join(dirname(fromDoc ?? ''), clean);
}

const UNKNOWN: Resolution = { title: null, broken: false };

// What a cross-reference role points at, by Sphinx's rules: labels and terms are
// case-insensitive, {doc} paths are relative to the current page.
function resolveRole(info: BuildInfo | null, fromSource: string | null, role: string, target: string): Resolution {
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
function resolveLink(info: BuildInfo | null, fromSource: string | null, href: string): Resolution {
  if (!info || /^[a-z][\w+.-]*:/i.test(href)) return UNKNOWN;
  const target = href.replace(/^#/, '');
  const label = info.objects.find((o) => o.domain === 'std' && o.type === 'label' && o.name === target.toLowerCase());
  if (label) return { title: label.title, broken: false };
  const fromDoc = fromSource ? docnameOf(info, fromSource) : null;
  const docname = docTarget(fromDoc, target.split('#')[0]);
  const doc = docname ? info.docs[docname] : undefined;
  return doc ? { title: doc.title, broken: false } : { title: null, broken: true };
}

// Targets for a cross-reference role, for autocomplete.
function suggestTargets(info: BuildInfo | null, fromSource: string | null, role: string): Suggestion[] {
  if (!info) return [];
  const std = (type: string) => info.objects.filter((o: BuildTarget) => o.domain === 'std' && o.type === type);
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


export const sphinxReferences: References = { role: resolveRole, link: resolveLink, suggest: suggestTargets };
