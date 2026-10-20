// Project-level MyST settings, read from a Sphinx conf.py.
//
// conf.py is Python and can compute anything, so this only recognises the common
// literal form `myst_enable_extensions = ["colon_fence", ...]` (list, tuple or set,
// possibly followed by `.append(...)`/`+=` additions). Real values will come from
// Sphinx itself once it runs in the background (phase 3).

export interface MystConfig {
  // Raw MyST-Parser extension names, e.g. "colon_fence", "dollarmath".
  extensions: string[];
  // Whether conf.py was found and read; false means "assume everything is enabled".
  fromConfPy: boolean;
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

export const DEFAULT_CONFIG: MystConfig = { extensions: Object.keys(OPTIONAL), fromConfPy: false };

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
  return { extensions: [...extensions], fromConfPy: true };
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
export function newDirectiveFence(config: MystConfig): string {
  return config.extensions.includes('colon_fence') ? ':::' : '```';
}
