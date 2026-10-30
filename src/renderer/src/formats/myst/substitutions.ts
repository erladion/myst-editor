// What a page's {{ name }} stands for: its front matter's substitutions (as
// MyST-Parser reads them, under `substitutions` or `myst.substitutions`), then
// conf.py's myst_substitutions.
import type { Node as PMNode } from 'prosemirror-model';
import { parse as parseYaml } from 'yaml';
import type { PageConfig } from '../../../../core/format';
import type { MystConfig } from '../../../../core/project-config';

const cache = new WeakMap<PMNode, Record<string, string>>();

// The front matter's, by the page's document.
function pageSubstitutions(doc: PMNode): Record<string, string> {
  const front = doc.firstChild;
  if (front?.type.name !== 'raw_block' || front.attrs.kind !== 'frontmatter') return {};
  const was = cache.get(front);
  if (was) return was;
  let out: Record<string, string> = {};
  try {
    const yaml = parseYaml((front.attrs.source as string).replace(/^---\n/, '').replace(/\n---\s*$/, '')) as Record<string, unknown> | null;
    const given = (yaml?.substitutions ?? (yaml?.myst as Record<string, unknown> | undefined)?.substitutions) as Record<string, unknown> | undefined;
    if (given && typeof given === 'object') out = Object.fromEntries(Object.entries(given).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v)).map(([k, v]) => [k, String(v)]));
  } catch {
    // not YAML the editor can read
  }
  cache.set(front, out);
  return out;
}

// The names there are, and what each stands for.
export function substitutionsFor(config: PageConfig, doc: PMNode): Record<string, string> {
  return { ...((config as MystConfig).substitutions ?? {}), ...pageSubstitutions(doc) };
}

export function substitutionShown(value: string, config: PageConfig, doc: PMNode) {
  const name = value.trim();
  const page = pageSubstitutions(doc);
  if (name in page) return { text: page[name] || `{{ ${name} }}`, title: `{{ ${name} }}: set in this page’s front matter` };
  const conf = (config as MystConfig).substitutions ?? {};
  if (name in conf) return { text: conf[name] || `{{ ${name} }}`, title: `{{ ${name} }}: set in conf.py (myst_substitutions)` };
  return { text: `{{ ${name} }}`, title: `{{ ${name} }} isn’t set in conf.py or this page’s front matter`, missing: true };
}
