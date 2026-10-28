// Asciidoctor's cross-references: what <<anchor>> and xref:page.adoc#anchor[] point
// at, from the last build, and the targets there are.
import type { BuildInfo } from '../../../../shared/build';
import type { Resolution, Suggestion } from '../../build';
import { dirname, join } from '../../paths';
import { relativePath } from '../../../../core/rename';
import type { References } from '../builder';

const UNKNOWN: Resolution = { title: null, broken: false };

// The page a target names (page.adoc, relative to the page it's written in), by its
// name in the build.
function docOf(info: BuildInfo, fromSource: string | null, target: string): string | null {
  const path = target.split('#')[0];
  if (!path) return fromSource ? (Object.entries(info.docs).find(([, d]) => d.source === fromSource)?.[0] ?? null) : null;
  const source = join(dirname(fromSource ?? ''), path);
  return Object.entries(info.docs).find(([, d]) => d.source === source)?.[0] ?? null;
}

function resolve(info: BuildInfo | null, fromSource: string | null, role: string, target: string): Resolution {
  if (!info) return UNKNOWN;
  const [path, id] = target.includes('#') ? target.split('#', 2) : role === 'ref' && !/\.adoc$/.test(target) ? ['', target] : [target, ''];
  // <<anchor>>: wherever it is in what's built with the page.
  if (!path && role === 'ref') {
    const hit = info.objects.find((o) => o.name === id);
    return { title: hit?.title ?? null, broken: !hit };
  }
  const doc = docOf(info, fromSource, path ? target : `#${id}`);
  if (!doc) return { title: null, broken: true };
  if (!id) return { title: info.docs[doc].title, broken: false };
  const hit = info.objects.find((o) => o.doc === doc && o.name === id);
  return { title: hit?.title ?? null, broken: !hit };
}

function suggest(info: BuildInfo | null, fromSource: string | null, role: string): Suggestion[] {
  if (!info) return [];
  const fromDir = dirname(fromSource ?? '');
  const anchors = info.objects.filter((o) => !o.name.startsWith('_') || o.type === 'section');
  if (role === 'ref') return anchors.map((o) => ({ value: o.name, label: o.title ? `${o.title} — ${o.doc}` : o.doc }));
  return [
    ...Object.values(info.docs).map((d) => ({ value: relativePath(fromDir, d.source), label: d.title ?? d.source })),
    ...anchors.map((o) => ({ value: `${relativePath(fromDir, info.docs[o.doc]?.source ?? `${o.doc}.adoc`)}#${o.name}`, label: `${o.title ?? o.name} — ${info.docs[o.doc]?.title ?? o.doc}` })),
  ];
}

export const asciidoctorReferences: References = {
  role: resolve,
  link: (info, fromSource, href) => (/\.adoc(#|$)/.test(href) ? resolve(info, fromSource, 'xref', href) : UNKNOWN),
  suggest,
};
