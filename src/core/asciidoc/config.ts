// How a project's AsciiDoc pages are read: the project's own editor settings, for now.
import { EMPTY_EDITOR_CONFIG, type EditorConfig } from '../editor-config.js';

export interface AsciidocConfig {
  format: 'asciidoc';
  // The project's own blocks, roles and conditions, from .mysteditor.toml.
  editor: EditorConfig;
}

export const ASCIIDOC_CONFIG: AsciidocConfig = { format: 'asciidoc', editor: EMPTY_EDITOR_CONFIG };

// Editor settings for AsciiDoc pages: conditions are written as ifdef::[] there.
export function asciidocEditor(editor: EditorConfig): EditorConfig {
  return { ...editor, conditions: editor.conditions && { ...editor.conditions, markers: 'ifdef' } };
}
