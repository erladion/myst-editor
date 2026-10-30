// AsciiDoc's attribute entries (:name: value), on their own or in the document's header
// with its author and revision lines; and blocks' attribute lines ([.lead], .Title).
// Shown as what they say, edited in forms. What a form doesn't change stays as written.
import { readHeader } from '../../../../core/asciidoc/parse';
import { ATTRIBUTE_ENTRY, PREPROCESSOR, isAttributeLine, isComment, isTitleLine, parseAttrlist, renderAttrlist, type Attrlist } from '../../../../core/asciidoc/syntax';
import type { Field } from '../../editor/context';
import type { CardForm } from '../editing';

interface Line {
  kind: 'entry' | 'unset' | 'author' | 'revision' | 'other';
  name: string;
  value: string; // an entry's, its lines after the first on lines of their own
  lines: string[]; // as written
}

const ENTRY = /^:(!?)([\w{][\w{}-]*)(!?):(?:[ \t]+(.*))?$/;

// Its lines, read: entries with the lines they go on over (ending in " \" or " +"),
// and in a header, the author and revision lines under the title.
function read(source: string, header: boolean): Line[] {
  const out: Line[] = [];
  const lines = source.split('\n');
  let people = header ? 0 : 2; // author and revision lines seen
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k];
    const m = ATTRIBUTE_ENTRY.test(l) ? ENTRY.exec(l) : null;
    if (m) {
      people = 2;
      const own = [l];
      while (/ (\\|\+)$/.test(own[own.length - 1]) && k + 1 < lines.length) own.push(lines[++k]);
      if (m[1] || m[3]) {
        out.push({ kind: 'unset', name: m[2], value: '', lines: own });
        continue;
      }
      // A value over lines: each on its own, without the backslash that goes on.
      const value = [m[4] ?? '', ...own.slice(1)].map((v, i, all) => (i < all.length - 1 ? v.replace(/[ \t]+\\$/, '') : v).trim()).join('\n');
      out.push({ kind: 'entry', name: m[2], value, lines: own });
      continue;
    }
    if (people < 2 && l.trim() && !isComment(l) && !PREPROCESSOR.test(l)) {
      out.push({ kind: people === 0 ? 'author' : 'revision', name: '', value: l.trim(), lines: [l] });
      people++;
      continue;
    }
    out.push({ kind: 'other', name: '', value: l, lines: [l] });
  }
  return out;
}

const LABELS = { author: 'Author', revision: 'Revision' };

export function entriesPreview(source: string, header: boolean): DocumentFragment {
  const table = document.createElement('table');
  table.className = 'field-list attribute-entries';
  for (const l of read(source, header)) {
    if (l.kind === 'other') continue;
    const row = table.insertRow();
    const name = document.createElement('th');
    name.textContent = l.kind === 'author' || l.kind === 'revision' ? LABELS[l.kind] : l.name;
    row.append(name);
    const cell = row.insertCell();
    if (l.kind === 'unset') {
      cell.textContent = 'not set';
      cell.className = 'muted';
    } else cell.textContent = l.value;
  }
  const out = document.createDocumentFragment();
  out.append(table);
  return out;
}

export function entriesForm(source: string, header: boolean): CardForm | null {
  const all = read(source, header);
  const fields: Field[] = [];
  const entries = all.filter((l) => l.kind === 'entry');
  all.forEach((l, i) => {
    if (l.kind === 'author' || l.kind === 'revision') fields.push({ key: `l${i}`, label: LABELS[l.kind], value: l.value, placeholder: l.kind === 'author' ? 'Name <email>; Another Name' : 'v1.0, 2026-01-01: What changed' });
    else if (l.kind === 'entry')
      fields.push({
        key: `l${i}`,
        label: l.name,
        value: l.value,
        removable: true,
        ...(l.value.includes('\n') ? { lines: Math.min(10, l.value.split('\n').length + 1) } : {}),
        ...(l === entries[entries.length - 1] ? { help: 'With no value, it’s set without one (as :toc: is).' } : {}),
      });
  });
  fields.push({ key: 'new', label: 'Another attribute', value: '', placeholder: 'name: value', help: 'Its name alone sets it without a value.' });
  return {
    title: header ? 'Document header' : 'Attributes',
    fields,
    source(values) {
      const lines: string[] = [];
      let lastEntry = -1;
      all.forEach((l, i) => {
        const value = values[`l${i}`];
        if (l.kind === 'other' || l.kind === 'unset') return void lines.push(...l.lines);
        if (l.kind === 'author' || l.kind === 'revision') {
          const v = (value ?? l.value).trim();
          // (An author line taken out under a revision line would make that the author's.)
          const revision = all.some((o) => o.kind === 'revision');
          if (v === l.value) lines.push(...l.lines);
          else if (v || (l.kind === 'author' && revision)) lines.push(v || l.lines[0]);
          return;
        }
        if (value === undefined) return; // removed
        const v = value.replace(/\s+$/, '').replace(/^\s*\n/, '');
        if (v === l.value || v.trim() === l.value) lines.push(...l.lines);
        else {
          const [first, ...rest] = v.split('\n').map((x) => x.trim());
          const written = [`:${l.name}:${first ? ` ${first}` : ''}`, ...rest];
          lines.push(...written.map((x, n) => (n < written.length - 1 ? `${x} \\` : x)));
        }
        lastEntry = lines.length - 1;
      });
      const added = /^:?([\w{][\w{}-]*):?(?:[ \t]+(.*))?$/.exec(values.new.trim());
      if (values.new.trim() && added) {
        const line = `:${added[1]}:${added[2]?.trim() ? ` ${added[2].trim()}` : ''}`;
        // After the last entry, or the lines it has (a header's author and revision).
        if (lastEntry >= 0) lines.splice(lastEntry + 1, 0, line);
        else lines.push(line);
      }
      return lines.join('\n') || source;
    },
  };
}

// ---- a block's attribute lines -----------------------------------------------------

// What a block's style makes it, for the writer.
const STYLES: Record<string, string> = {
  float: 'A heading left out of the contents',
  discrete: 'A heading left out of the contents',
  hardbreaks: 'Its line breaks kept',
  horizontal: 'Terms beside what they mean',
  qanda: 'Questions and answers',
  appendix: 'An appendix',
  preface: 'The preface',
  glossary: 'The glossary',
  bibliography: 'The bibliography',
  colophon: 'The colophon',
  dedication: 'The dedication',
  abstract: 'The abstract',
  partintro: 'The part’s introduction',
  index: 'The index',
  verse: 'A verse',
  quote: 'A quote',
  source: 'Source code',
  listing: 'A listing',
  literal: 'Text as written',
  pass: 'Passed through as written',
  square: 'Square bullets',
  circle: 'Round bullets',
  disc: 'Disc bullets',
  none: 'No bullets',
  arabic: 'Numbered 1, 2, 3',
  decimal: 'Numbered 01, 02, 03',
  loweralpha: 'Numbered a, b, c',
  upperalpha: 'Numbered A, B, C',
  lowerroman: 'Numbered i, ii, iii',
  upperroman: 'Numbered I, II, III',
  lowergreek: 'Numbered α, β, γ',
  note: 'A note',
  tip: 'A tip',
  important: 'Important',
  caution: 'A caution',
  warning: 'A warning',
};
const OPTIONS: Record<string, string> = { hardbreaks: 'Its line breaks kept', reversed: 'Numbered backwards', interactive: 'Ticked by the reader', collapsible: 'Opened by the reader', open: 'Open at first' };

// The lines' parts: a title, one attribute list (anchors and more: null).
function blockLines(source: string): { title: string | null; titleLine: number; list: Attrlist | null; listLine: number } | null {
  const lines = source.split('\n');
  let title: string | null = null;
  let titleLine = -1;
  let list: Attrlist | null = null;
  let listLine = -1;
  for (const [k, l] of lines.entries()) {
    if (isTitleLine(l) && title === null) {
      title = l.slice(1).trim();
      titleLine = k;
    } else if (isAttributeLine(l) && !/^\[\[/.test(l) && !list) {
      list = parseAttrlist(l.trim().slice(1, -1));
      if (!list) return null;
      listLine = k;
    } else return null;
  }
  return { title, titleLine, list, listLine };
}

// What the lines say, a chip each: "Title: …", "Id: …", what its style makes it.
export function blockAttributesPreview(source: string): DocumentFragment {
  const out = document.createDocumentFragment();
  const header = readHeader(source.split('\n'));
  if (!header) return out;
  const chips: string[] = [];
  const { attrs } = header;
  if (header.title) chips.push(`Title: ${header.title}`);
  if (attrs.style) chips.push(STYLES[attrs.style.toLowerCase()] ?? `Style: ${attrs.style}`);
  if (attrs.id) chips.push(`Id: ${attrs.id}`);
  if (attrs.roles.length) chips.push(`Styled as ${attrs.roles.join(', ')}`);
  for (const o of attrs.opts) chips.push(OPTIONS[o] ?? `Option: ${o}`);
  attrs.positional.forEach((p) => chips.push(p));
  for (const [k, v] of attrs.named) chips.push(k === 'start' ? `Starts at ${v}` : k === 'reftext' ? `Referred to as “${v}”` : `${k}: ${v}`);
  const box = document.createElement('div');
  box.className = 'chips';
  for (const c of chips.length ? chips : ['No attributes']) box.append(Object.assign(document.createElement('span'), { className: 'chip', textContent: c }));
  out.append(box);
  return out;
}

export function blockAttributesForm(source: string): CardForm | null {
  const parts = blockLines(source);
  if (!parts) return null;
  const list = parts.list ?? { style: '', id: null, roles: [], opts: [], positional: [], named: [] };
  const rest = renderAttrlist({ ...list, style: '', id: null, roles: [], opts: [] }).replace(/^\[,?|\]$/g, '');
  return {
    title: 'Block attributes',
    fields: [
      { key: 'title', label: 'Title', value: parts.title ?? '', help: 'Shown above the block.' },
      { key: 'style', label: 'Style', value: list.style, placeholder: 'discrete, square, source…' },
      { key: 'id', label: 'Id', value: list.id ?? '', help: 'What cross-references to it name.' },
      { key: 'roles', label: 'Roles', value: list.roles.join(' '), placeholder: 'lead', help: 'Its classes, for the theme’s styles: separated by spaces.' },
      { key: 'opts', label: 'Options', value: list.opts.join(' '), placeholder: 'hardbreaks', help: 'Separated by spaces.' },
      { key: 'rest', label: 'Other attributes', value: rest, placeholder: 'start=4', help: 'As written in the brackets: separated by commas.' },
    ],
    source(values) {
      const lines = source.split('\n');
      const title = values.title.trim();
      const words = (v: string) => v.split(/[\s,]+/).filter(Boolean);
      const others = values.rest.trim() ? parseAttrlist(`x,${values.rest.trim()}`) : { positional: [], named: [] };
      const next: Attrlist = {
        style: values.style.trim(),
        id: values.id.trim().replace(/^#/, '') || null,
        roles: words(values.roles).map((r) => r.replace(/^\./, '')),
        opts: words(values.opts).map((o) => o.replace(/^%/, '')),
        positional: others?.positional ?? list.positional,
        named: others?.named ?? list.named,
      };
      const empty = !next.style && !next.id && !next.roles.length && !next.opts.length && !next.positional.length && !next.named.length;
      const titleLine = !title ? null : title === parts.title ? lines[parts.titleLine] : `.${title}`;
      const listLine = parts.list && renderAttrlist(next) === renderAttrlist(list) ? lines[parts.listLine] : empty ? null : renderAttrlist(next);
      // In the order they were (a new title first).
      const titleFirst = parts.titleLine < 0 || parts.listLine < 0 || parts.titleLine < parts.listLine;
      return (titleFirst ? [titleLine, listLine] : [listLine, titleLine]).filter((l) => l !== null).join('\n');
    },
  };
}
