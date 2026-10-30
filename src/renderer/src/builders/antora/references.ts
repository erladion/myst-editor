// An Antora component's cross-references: xref:page.adoc#anchor[] by resource ID
// (see core/asciidoc/antora.ts), from the page's module; <<anchor>> on the page. From
// the last build, with the targets there are.
import type { BuildInfo } from '../../../../shared/build';
import type { Resolution, Suggestion } from '../../build';
import { isComponentPage, resolveResource, resourceIdFor, type Antora } from '../../../../core/asciidoc/antora';
import type { References } from '../builder';

const UNKNOWN: Resolution = { title: null, broken: false };

// A path from the opened folder, as the component has it; and back.
export const inComponent = (antora: Antora, path: string) => (antora.root && path.startsWith(antora.root + '/') ? path.slice(antora.root.length + 1) : path);
export const fromComponent = (antora: Antora, rel: string) => (antora.root ? `${antora.root}/${rel}` : rel);

const stem = (file: string) => file.replace(/\.adoc$/, '');

export function antoraReferences(antora: Antora): References {
  const here = (fromSource: string | null) => inComponent(antora, fromSource ?? '');
  const anchorOn = (info: BuildInfo, doc: string, id: string): Resolution => {
    const hit = info.objects.find((o) => o.doc === doc && o.name === id);
    return { title: hit?.title ?? null, broken: !hit };
  };
  const resolve = (info: BuildInfo | null, fromSource: string | null, role: string, target: string): Resolution => {
    if (!info) return UNKNOWN;
    const from = here(fromSource);
    // <<anchor>>, and xref:anchor[]: on the page.
    if (role === 'ref' || !/\.adoc(#|$)/.test(target)) return anchorOn(info, stem(from), target.replace(/^#/, ''));
    const found = resolveResource(antora, from, target, 'page');
    if (!found) return UNKNOWN; // another component's
    const doc = info.docs[stem(found.file)];
    if (!doc) return { title: null, broken: true };
    return found.fragment ? anchorOn(info, stem(found.file), found.fragment) : { title: doc.title, broken: false };
  };
  return {
    role: resolve,
    link: () => UNKNOWN,
    suggest(info, fromSource, role) {
      if (!info) return [];
      const from = here(fromSource);
      const anchors = info.objects.filter((o) => !o.name.startsWith('_') || o.type === 'section');
      if (role === 'ref') return anchors.filter((o) => o.doc === stem(from)).map((o) => ({ value: o.name, label: o.title ?? o.name }));
      const pages = Object.entries(info.docs).filter(([name]) => isComponentPage(`${name}.adoc`));
      const id = (name: string) => resourceIdFor(from, `${name}.adoc`, 'page');
      const out: Suggestion[] = [];
      for (const [name, doc] of pages) {
        const value = id(name);
        if (value) out.push({ value, label: doc.title ?? name });
      }
      for (const o of anchors) {
        const value = id(o.doc);
        if (value && info.docs[o.doc]) out.push({ value: `${value}#${o.name}`, label: `${o.title ?? o.name} — ${info.docs[o.doc].title ?? o.doc}` });
      }
      return out;
    },
  };
}
