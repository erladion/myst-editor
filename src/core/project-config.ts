// Project-level MyST settings, read from a Sphinx conf.py.
//
// conf.py is Python and can compute anything, so this only recognises the common
// literal form `myst_enable_extensions = ["colon_fence", ...]` (list, tuple or set,
// possibly followed by `.append(...)`/`+=` additions). Real values will come from
// Sphinx itself once it runs in the background (phase 3).

import { EMPTY_EDITOR_CONFIG, type EditorConfig } from './editor-config.js';
import type { PageConfig } from './format.js';

export interface MystConfig {
  format: 'myst';
  // Raw MyST-Parser extension names, e.g. "colon_fence", "dollarmath".
  extensions: string[];
  // Whether conf.py was found and read; false means "assume everything is enabled".
  fromConfPy: boolean;
  // numfig = True: figures and tables are numbered, and {numref} works.
  numfig?: boolean;
  // myst_substitutions: what {{ name }} stands for, where it's a string.
  substitutions?: Record<string, string>;
  // The project's own directives, roles and conditions, from .wysie.toml.
  editor: EditorConfig;
}

// myst-parser (JS) extension flags for each MyST-Parser (Sphinx) extension name.
// Footnotes, front matter, block breaks and tables are always on in Sphinx.
const OPTIONAL: Record<string, string> = {
  colon_fence: 'colonFences',
  dollarmath: 'math',
  deflist: 'deflist',
  tasklist: 'tasklist',
  strikethrough: 'strikethrough',
};

// Extensions the editor reads itself (myst-parser doesn't know them).
export const OWN_SYNTAX = ['substitution'] as const;

export const DEFAULT_CONFIG: MystConfig = { format: 'myst', extensions: [...Object.keys(OPTIONAL), ...OWN_SYNTAX], fromConfPy: false, editor: EMPTY_EDITOR_CONFIG };

export function readConfPy(source: string): MystConfig {
  const extensions = new Set<string>();
  const strings = (text: string) => [...text.matchAll(/["']([\w-]+)["']/g)].map((m) => m[1]);
  for (const m of source.matchAll(/^\s*myst_enable_extensions\s*(\+?=)\s*[[({]([^\])}]*)[\])}]/gm)) {
    if (m[1] === '=') extensions.clear();
    strings(m[2]).forEach((e) => extensions.add(e));
  }
  for (const m of source.matchAll(/myst_enable_extensions\s*\.\s*(?:append|add)\(\s*["']([\w-]+)["']\s*\)/g)) {
    extensions.add(m[1]);
  }
  for (const m of source.matchAll(/myst_enable_extensions\s*\.\s*extend\(\s*[[({]([^\])}]*)[\])}]\s*\)/g)) {
    strings(m[1]).forEach((e) => extensions.add(e));
  }
  return { format: 'myst', extensions: [...extensions], fromConfPy: true, numfig: /^\s*numfig\s*=\s*True\b/m.test(source), substitutions: substitutionsOf(source), editor: EMPTY_EDITOR_CONFIG };
}

// myst_substitutions = {"product": "Widget", ...}: its string values.
function substitutionsOf(source: string): Record<string, string> {
  const m = /^\s*myst_substitutions\s*=\s*\{([\s\S]*?)^\s*\}/m.exec(source) ?? /^\s*myst_substitutions\s*=\s*\{([^}\n]*)\}/m.exec(source);
  const out: Record<string, string> = {};
  if (!m) return out;
  for (const e of m[1].matchAll(/(["'])([\w-]+)\1\s*:\s*(["'])((?:\\.|(?!\3).)*)\3/g)) out[e[2]] = e[4].replace(/\\(.)/g, '$1');
  return out;
}

// A page's settings, known to be MyST's: for MyST's own code.
export function mystConfig(config: PageConfig): MystConfig {
  if (config.format !== 'myst') throw new Error(`MyST settings wanted, ${config.format} given`);
  return config;
}

// Flags for myst-parser matching the project's enabled extensions.
export function parserExtensions(config: MystConfig): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  for (const [name, flag] of Object.entries(OPTIONAL)) flags[flag] = config.extensions.includes(name);
  // amsmath environments are parsed by the same math plugin.
  if (config.extensions.includes('amsmath')) flags.math = true;
  return flags;
}

// The fence for directives the writer inserts: colon fences need the extension.
export function newDirectiveFence(config: PageConfig): string {
  return mystConfig(config).extensions.includes('colon_fence') ? ':::' : '```';
}
