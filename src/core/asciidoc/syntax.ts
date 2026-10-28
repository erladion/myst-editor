// AsciiDoc's line-level syntax: what a line starts, and block attribute lists.

// Delimiter lines of delimited blocks, by their character. The closing line is the
// opening one repeated exactly; four or more of the character (open blocks: two dashes).
const DELIMITER = /^(-{4,}|\.{4,}|={4,}|\*{4,}|_{4,}|\+{4,}|\/{4,}|--|[|!,:]={3,}|`{3,}[\w+#.-]*)[ \t]*$/;

export function delimiterOf(line: string): string | null {
  const m = DELIMITER.exec(line);
  if (!m) return null;
  // A Markdown-style code fence closes with its backticks alone.
  return m[1].startsWith('`') ? /^`+/.exec(m[1])![0] : m[1];
}

// The line that closes a block opened by `delimiter`.
export function closes(line: string, delimiter: string): boolean {
  return line.trimEnd() === delimiter;
}

export const isBlank = (line: string) => line.trim() === '';

// `[...]`: a block's attribute list, or an anchor `[[id]]`.
export const isAttributeLine = (line: string) => /^\[(?:|[\p{L}\p{N}_.#%{,"'\[ ].*)\][ \t]*$/u.test(line) && !/^\[\[.*\]\][ \t]*\S/.test(line);

// `.Title`: the next block's title (not a literal delimiter, not `. item`).
export const isTitleLine = (line: string) => /^\.[^\s.]/.test(line) && !/^\.{4,}[ \t]*$/.test(line);

// `[[id]]` or `[#id]` alone: an anchor for what follows.
export function anchorOf(line: string): string | null {
  return /^\[\[([A-Za-z_:][\w:.-]*)\]\][ \t]*$/.exec(line)?.[1] ?? /^\[#([A-Za-z_:][\w:-]*)\][ \t]*$/.exec(line)?.[1] ?? null;
}

export const isHeaderLine = (line: string) => isAttributeLine(line) || isTitleLine(line);

export const SECTION = /^(={1,6}|#{1,6})[ \t]+(\S.*?)[ \t]*$/;

// `:name: value`, `:name!:`, `:!name:`. A value can go on over lines ending in ` \`.
export const ATTRIBUTE_ENTRY = /^:!?[\w{][\w{}-]*!?:(?:[ \t]+.*)?$/;

export const isComment = (line: string) => /^\/\/(?!\/\/)/.test(line) && !/^\/{4,}[ \t]*$/.test(line);

export const PREPROCESSOR = /^(?:ifdef|ifndef|ifeval|endif)::/;

// `name::target[attributes]`: a block macro (image, include, toc, video...).
export const BLOCK_MACRO = /^([A-Za-z][\w-]*)::(\S*?)\[(.*)\][ \t]*$/;

export const ADMONITION_PARAGRAPH = /^(NOTE|TIP|IMPORTANT|CAUTION|WARNING):[ \t]+/;
export const ADMONITIONS = ['note', 'tip', 'important', 'caution', 'warning'];

// List items: their marker and text.
export const UNORDERED_ITEM = /^[ \t]*(-|\*{1,5})[ \t]+(\S.*)$/;
export const ORDERED_ITEM = /^[ \t]*(\.{1,5}|\d+\.)[ \t]+(\S.*)$/;
export const DESCRIPTION_ITEM = /^[ \t]*(?!\/\/)(\S.*?)(:{2,4}|;;)(?:[ \t]+(.*))?$/;
export const CALLOUT_ITEM = /^<(?:\d+|\.)>[ \t]+\S/;

export function listItem(line: string): { marker: string; text: string; ordered: boolean } | null {
  const u = UNORDERED_ITEM.exec(line);
  if (u) return { marker: u[1], text: u[2], ordered: false };
  const o = ORDERED_ITEM.exec(line);
  return o ? { marker: o[1], text: o[2], ordered: true } : null;
}

export const isDescriptionItem = (line: string) => !BLOCK_MACRO.test(line) && !PREPROCESSOR.test(line) && DESCRIPTION_ITEM.test(line);

// ---- attribute lists ----------------------------------------------------------

export interface Attrlist {
  style: string; // the first positional attribute, without its shorthands
  id: string | null; // `#id`
  roles: string[]; // `.role`
  opts: string[]; // `%option`
  positional: string[]; // the others, in order
  named: [string, string][];
}

// `[source%linenums,python,id=x]` → its parts. Null if it isn't one we can read and
// write back (unbalanced quotes, say).
export function parseAttrlist(inner: string): Attrlist | null {
  const list = tokens(inner);
  if (!list) return null;
  const out: Attrlist = { style: '', id: null, roles: [], opts: [], positional: [], named: [] };
  list.forEach((t, n) => {
    if (t.name !== undefined) out.named.push([t.name, t.value]);
    else if (n > 0) out.positional.push(t.value);
    else if (t.quoted) out.style = t.value;
    else {
      const m = /^([^#.%]*)((?:[#.%][^#.%]*)*)$/.exec(t.value)!;
      out.style = m[1];
      for (const s of m[2].match(/[#.%][^#.%]*/g) ?? []) {
        if (s[0] === '#') out.id = s.slice(1);
        else if (s[0] === '.') out.roles.push(s.slice(1));
        else out.opts.push(s.slice(1));
      }
    }
  });
  return out;
}

// An attribute list's entries: `name=value`, or positional; values may be quoted.
function tokens(inner: string): { name?: string; value: string; quoted: boolean }[] | null {
  const out: { name?: string; value: string; quoted: boolean }[] = [];
  if (!inner.trim()) return out;
  let i = 0;
  const space = () => {
    while (inner[i] === ' ' || inner[i] === '\t') i++;
  };
  for (;;) {
    space();
    let name: string | undefined;
    const named = /^([\w-]+)[ \t]*=[ \t]*/.exec(inner.slice(i));
    if (named) {
      name = named[1];
      i += named[0].length;
    }
    let value: string;
    let quoted = false;
    if (inner[i] === '"' || inner[i] === "'") {
      const q = inner[i];
      let j = i + 1;
      while (j < inner.length && (inner[j] !== q || inner[j - 1] === '\\')) j++;
      if (j >= inner.length) return null;
      value = inner.slice(i + 1, j).split(`\\${q}`).join(q);
      quoted = true;
      i = j + 1;
      space();
      if (i < inner.length && inner[i] !== ',') return null;
    } else {
      let j = inner.indexOf(',', i);
      if (j < 0) j = inner.length;
      value = inner.slice(i, j).trim();
      i = j;
    }
    out.push({ name, value, quoted });
    if (i >= inner.length) return out;
    i++;
  }
}

const quote = (v: string) => (/^$|[,"'\]]|^\s|\s$/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v);

export function renderAttrlist(a: Attrlist): string {
  const first = a.style + (a.id ? `#${a.id}` : '') + a.roles.map((r) => `.${r}`).join('') + a.opts.map((o) => `%${o}`).join('');
  const rest = [...a.positional.map(quote), ...a.named.map(([k, v]) => `${k}=${quote(v)}`)];
  if (!rest.length) return `[${first}]`;
  return `[${[first, ...rest].join(',')}]`;
}
