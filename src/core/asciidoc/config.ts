// How a project's AsciiDoc pages are read: the project's editor settings, and (in an
// Asciidoctor project) its main document and the attributes its header sets.
import { EMPTY_EDITOR_CONFIG, type EditorConfig } from '../editor-config.js';

export interface AsciidocConfig {
  format: 'asciidoc';
  // The project's own blocks, roles and conditions, from .mysteditor.toml.
  editor: EditorConfig;
  // The document that includes the others, relative to the project; null when its
  // pages stand on their own.
  main: string | null;
  // Attributes the main document's header sets (:name: value), for every page.
  attributes: Record<string, string>;
}

export const ASCIIDOC_CONFIG: AsciidocConfig = { format: 'asciidoc', editor: EMPTY_EDITOR_CONFIG, main: null, attributes: {} };

// Editor settings for AsciiDoc pages: conditions are written as ifdef::[] there.
export function asciidocEditor(editor: EditorConfig): EditorConfig {
  return { ...editor, conditions: editor.conditions && { ...editor.conditions, markers: 'ifdef' } };
}

// The attributes a document's header sets: the entries under its title, up to the
// first blank line. `:name!:` unsets one (it's left out).
export function headerAttributes(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  let k = 0;
  while (k < lines.length && (!lines[k].trim() || /^\/\//.test(lines[k]))) k++;
  if (!/^[=#][ \t]/.test(lines[k] ?? '')) return out;
  for (k++; k < lines.length && lines[k].trim(); k++) {
    const m = /^:([\w][\w-]*)(!?):(?:[ \t]+(.*))?$/.exec(lines[k]);
    if (m && !m[2]) out[m[1]] = (m[3] ?? '').trim();
  }
  return out;
}
