// Project Settings' changes to a .mysteditor.toml: written into its text (see
// toml-edit.ts), so the rest of the file stays as the project wrote it.
import { ensureTomlTable, removeTomlTableIfEmpty, setTomlKey, tomlAt, type TomlValue } from './toml-edit.js';
import type { CoverPart, CoverPlace } from './editor-config.js';

// What changed in the conditional-content settings. A missing field is unchanged;
// null takes the setting out (back to its default).
export interface ConditionsPatch {
  enabled?: boolean;
  capabilities?: string | null; // the capabilities file, relative to the settings file
  key?: string | null; // where the list is in it
  block?: [string, string];
  inline?: [string, string];
  caseSensitive?: boolean;
  colors?: Record<string, string | null>; // by expression; null: chosen automatically
}

// The settings file's text with the patch applied. `outerOff`: a settings file
// further out turns conditional content off, so turning it on here must say so.
// Throws if the result isn't what was asked for (a layout this can't change).
export function editConditions(text: string, patch: ConditionsPatch, outerOff = false): string {
  const writes: [string[], TomlValue | undefined][] = [];
  if (patch.enabled !== undefined) writes.push([['enabled'], patch.enabled ? (outerOff ? true : undefined) : false]);
  if (patch.capabilities !== undefined) writes.push([['capabilities'], patch.capabilities ?? undefined]);
  if (patch.key !== undefined) writes.push([['key'], patch.key ?? undefined]);
  if (patch.block) writes.push([['block'], patch.block]);
  if (patch.inline) writes.push([['inline'], patch.inline]);
  if (patch.caseSensitive !== undefined) writes.push([['case_sensitive'], patch.caseSensitive]);
  for (const [expr, color] of Object.entries(patch.colors ?? {})) writes.push([['colors', expr], color ?? undefined]);

  const next = write(patch.enabled ? ensureTomlTable(text, ['conditions']) : text, 'conditions', writes);
  if (patch.enabled && tomlAt(next, ['conditions']) === undefined) throw new Error('couldn’t add [conditions]');
  return next;
}

// Writes into a table (paths within it; undefined takes a key out), checked by
// reading the result back.
function write(text: string, table: string, writes: [string[], TomlValue | undefined][]): string {
  let next = text;
  for (const [path, value] of writes) next = setTomlKey(next, [table, ...path.slice(0, -1)], path[path.length - 1], value);
  for (const [path, value] of writes) {
    if (JSON.stringify(tomlAt(next, [table, ...path])) !== JSON.stringify(value)) throw new Error(`couldn’t set ${[table, ...path].join('.')}`);
  }
  return next;
}

// What changed in the PDF settings; null takes a setting out (back to its default).
export interface PdfPatch {
  paper?: string | null;
  logo?: string | null;
  title?: string | null;
  subtitle?: string | null;
  note?: string | null;
  coverBackground?: string | null;
  coverColor?: string | null;
  coverImages?: { file: string; x: number; y: number; width: number; height?: number }[] | null;
  // Parts of the cover moved (null: back to their usual places).
  cover?: Partial<Record<CoverPart, CoverPlace | null>>;
  font?: string | null;
  headingFont?: string | null;
  codeFont?: string | null;
  fonts?: string[] | null;
  header?: [string, string, string] | null;
  footer?: [string, string, string] | null;
  headersOn?: string | null;
  numbering?: string | null;
  tocDepth?: number | null;
  siteCss?: boolean | null;
  css?: string | null;
  variables?: Record<string, string | null>; // by name; null: taken out
}

export function editPdf(text: string, patch: PdfPatch): string {
  const keys: [keyof PdfPatch, string][] = [
    ['paper', 'paper'], ['logo', 'logo'], ['title', 'title'], ['subtitle', 'subtitle'], ['note', 'note'],
    ['coverBackground', 'cover_background'], ['coverColor', 'cover_color'], ['coverImages', 'cover_images'],
    ['font', 'font'], ['headingFont', 'heading_font'], ['codeFont', 'code_font'], ['fonts', 'fonts'],
    ['header', 'header'], ['footer', 'footer'], ['headersOn', 'headers_on'], ['numbering', 'numbering'], ['tocDepth', 'toc_depth'],
    ['siteCss', 'site_css'], ['css', 'css'],
  ];
  const writes: [string[], TomlValue | undefined][] = [];
  for (const [field, key] of keys) {
    const v = patch[field];
    // An empty list (of graphics, of fonts): the setting goes.
    if (v !== undefined) writes.push([[key], v === null || (Array.isArray(v) && !v.length) ? undefined : (v as TomlValue)]);
  }
  for (const [part, place] of Object.entries(patch.cover ?? {})) {
    for (const key of ['x', 'y', 'width', 'size', 'align'] as const) {
      const v = place ? place[key] : null;
      writes.push([['cover', part, key], v === null || v === undefined ? undefined : v]);
    }
  }
  for (const [name, value] of Object.entries(patch.variables ?? {})) writes.push([['variables', name], value ?? undefined]);
  let next = write(text, 'pdf', writes);
  if (patch.variables) next = removeTomlTableIfEmpty(next, ['pdf', 'variables']);
  // A part back in its usual place: its table goes.
  for (const [part, place] of Object.entries(patch.cover ?? {})) if (!place) next = removeTomlTableIfEmpty(next, ['pdf', 'cover', part]);
  return next;
}
