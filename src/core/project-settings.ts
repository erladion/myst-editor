// Project Settings' changes to a .mysteditor.toml: written into its text (see
// toml-edit.ts), so the rest of the file stays as the project wrote it.
import { ensureTomlTable, setTomlKey, tomlAt, type TomlValue } from './toml-edit.js';

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

  let next = text;
  if (patch.enabled) next = ensureTomlTable(next, ['conditions']);
  for (const [path, value] of writes) next = setTomlKey(next, ['conditions', ...path.slice(0, -1)], path[path.length - 1], value);
  for (const [path, value] of writes) {
    if (JSON.stringify(tomlAt(next, ['conditions', ...path])) !== JSON.stringify(value)) throw new Error(`couldn’t set ${['conditions', ...path].join('.')}`);
  }
  if (patch.enabled && tomlAt(next, ['conditions']) === undefined) throw new Error('couldn’t add [conditions]');
  return next;
}
