// Per-project editor settings from `.mysteditor.toml`: how to present a project's own
// directives and roles, and its conditional-content markers.
//
//   [directives.company-callout]
//   label = "Internal note"
//   tone = "warning"            # note | info | tip | warning | danger | neutral
//   body = "markdown"           # markdown (editable) | text (code-like) | none
//   argument = "Title"          # what the argument means; leave out for none
//   [directives.company-callout.options.audience]
//   label = "Audience"
//   choices = ["internal", "partners"]
//
//   [roles.jira]
//   label = "Jira issue"
//   url = "https://jira.example.com/browse/{value}"
//
//   [tables]
//   colspan_role = "colspan"     # cells written as {colspan}`2` text, covered cells empty
//   rowspan_role = "rowspan"
//
//   [conditions]
//   enabled = true                       # false turns it off, keeping the settings
//   capabilities = "capabilities.json"   # relative to this file
//   block = ["if", "endif"]
//   inline = ["if-inline", "endif-inline"]
//
//   [sphinx.env]                         # environment variables for Sphinx builds
//   PRODUCT = "enterprise"               # (conf.py may read os.environ)
//
//   [conditions.colors]                  # optional; otherwise chosen automatically
//   CapabilityX = "teal"                 # a palette colour, or "#0a7f6f"
//   "CapabilityX or CapabilityY" = "orange"
import { parse as parseToml } from 'smol-toml';

export const SETTINGS_FILE = '.mysteditor.toml';

export type Tone = 'note' | 'info' | 'tip' | 'warning' | 'danger' | 'neutral';
const TONES: Tone[] = ['note', 'info', 'tip', 'warning', 'danger', 'neutral'];

export interface OptionDef {
  label?: string;
  help?: string;
  choices?: string[];
  flag?: boolean; // present or absent, without a value
  default?: string; // used when inserting the directive
}

export interface DirectiveDef {
  label?: string;
  tone?: Tone;
  body: 'markdown' | 'text' | 'none';
  argument?: string; // label for the argument field
  options: Record<string, OptionDef>;
  insert: boolean; // offered in the Insert menu
}

export interface RoleDef {
  label?: string;
  url?: string; // "{value}" is replaced with the role's content
}

export interface ConditionsDef {
  block: [string, string];
  inline: [string, string];
  caseSensitive: boolean;
  capabilities: string[]; // known capability names, from the JSON file
  capabilitiesFile: string | null; // as written in the settings
  // Where it is (relative to the opened folder), and where the list is in it: for
  // adding a capability from the app. Null when it can't be told.
  capabilitiesPath: string | null;
  capabilitiesKey: string | null;
  // Colours chosen for conditions, by expression as written (a capability name, or
  // "X or Y"): a palette colour name or a #hex colour.
  colors: Record<string, string>;
}

// Named colours for conditions (light and dark shades are in the stylesheet).
// Neighbours contrast, since capabilities take them in order.
export const CONDITION_PALETTE = ['purple', 'orange', 'teal', 'magenta', 'blue', 'olive', 'green', 'slate'] as const;

export interface SettingsProblem {
  file: string; // relative to the opened folder
  message: string;
}

// Roles a project's extension uses for merged table cells, e.g. {colspan}`2`.
export interface TableSpans {
  colspan?: string;
  rowspan?: string;
}

export interface EditorConfig {
  directives: Record<string, DirectiveDef>;
  roles: Record<string, RoleDef>;
  tables: TableSpans;
  conditions: ConditionsDef | null; // null when not used (or turned off)
  // The [conditions] settings even when turned off (enabled = false): for Project
  // Settings, to turn them on again as they were.
  conditionSettings: ConditionsDef | null;
  // Environment variables for the project's Sphinx builds.
  sphinxEnv: Record<string, string>;
  problems: SettingsProblem[];
}

// A name a process environment can hold (and a shell would accept).
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const EMPTY_EDITOR_CONFIG: EditorConfig = { directives: {}, roles: {}, tables: {}, conditions: null, conditionSettings: null, sphinxEnv: {}, problems: [] };

const DEFAULT_CONDITIONS: Omit<ConditionsDef, 'capabilities' | 'capabilitiesFile' | 'capabilitiesPath' | 'capabilitiesKey' | 'colors'> = {
  block: ['if', 'endif'],
  inline: ['if-inline', 'endif-inline'],
  caseSensitive: true,
};

type Raw = Record<string, unknown>;
const isTable = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

// One settings file: its contents, plus a reader for the capabilities file it names.
export interface SettingsSource {
  file: string; // relative to the opened folder, for messages
  text: string;
  readCapabilities: (path: string) => string; // throws if unreadable
}

// Merge the settings files that apply to a project, outermost first: later files
// override earlier ones per directive, per role and per conditions setting.
export function loadEditorConfig(sources: SettingsSource[]): EditorConfig {
  const config: EditorConfig = { directives: {}, roles: {}, tables: {}, conditions: null, conditionSettings: null, sphinxEnv: {}, problems: [] };
  for (const source of sources) applySettings(config, source);
  return config;
}

function applySettings(config: EditorConfig, { file, text, readCapabilities }: SettingsSource) {
  const problem = (message: string) => config.problems.push({ file, message });
  let raw: Raw;
  try {
    raw = parseToml(text) as Raw;
  } catch (e) {
    problem(`Not valid TOML: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
    return;
  }
  for (const key of Object.keys(raw)) {
    if (!['directives', 'roles', 'tables', 'conditions', 'sphinx'].includes(key)) problem(`Unknown section [${key}] (expected directives, roles, tables, conditions or sphinx)`);
  }

  if (raw.sphinx !== undefined) {
    const sx = raw.sphinx;
    if (!isTable(sx)) problem('[sphinx] must be a table');
    else {
      for (const key of Object.keys(sx)) if (key !== 'env') problem(`[sphinx] unknown setting "${key}"`);
      if (sx.env !== undefined && !isTable(sx.env)) problem('[sphinx.env] must be a table, like PRODUCT = "enterprise"');
      else if (sx.env) {
        for (const [name, value] of Object.entries(sx.env)) {
          if (!ENV_NAME.test(name)) problem(`[sphinx.env] "${name}" isn’t a valid variable name`);
          else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') config.sphinxEnv[name] = String(value);
          else problem(`[sphinx.env] ${name} must be text, a number or true/false`);
        }
      }
    }
  }

  if (raw.tables !== undefined) {
    const t = raw.tables;
    if (!isTable(t)) problem('[tables] must be a table');
    else {
      for (const [key, field] of [['colspan_role', 'colspan'], ['rowspan_role', 'rowspan']] as const) {
        if (t[key] === undefined) continue;
        if (typeof t[key] === 'string' && /^[\w:.-]+$/.test(t[key] as string)) config.tables = { ...config.tables, [field]: t[key] as string };
        else problem(`[tables] ${key} must be a role name, like "${field}"`);
      }
      for (const key of Object.keys(t)) if (!['colspan_role', 'rowspan_role'].includes(key)) problem(`[tables] unknown setting "${key}"`);
    }
  }

  if (raw.directives !== undefined) {
    if (!isTable(raw.directives)) problem('[directives] must be a table of directive names');
    else for (const [name, def] of Object.entries(raw.directives)) {
      const d = readDirective(name, def, problem);
      if (d) config.directives[name] = d;
    }
  }

  if (raw.roles !== undefined) {
    if (!isTable(raw.roles)) problem('[roles] must be a table of role names');
    else for (const [name, def] of Object.entries(raw.roles)) {
      if (!isTable(def)) {
        problem(`[roles.${name}] must be a table`);
        continue;
      }
      const role: RoleDef = {};
      if (typeof def.label === 'string') role.label = def.label;
      if (typeof def.url === 'string') {
        if (/^https?:\/\//.test(def.url)) role.url = def.url;
        else problem(`[roles.${name}] url must start with http:// or https://`);
      }
      config.roles[name] = role;
    }
  }

  if (raw.conditions !== undefined) {
    const c = raw.conditions;
    if (!isTable(c)) {
      problem('[conditions] must be a table');
      return;
    }
    const prev = config.conditionSettings;
    let enabled = prev ? config.conditions !== null : true;
    if (c.enabled !== undefined) {
      if (typeof c.enabled === 'boolean') enabled = c.enabled;
      else problem('[conditions] enabled must be true or false');
    }
    const next: ConditionsDef = {
      ...DEFAULT_CONDITIONS,
      capabilities: prev?.capabilities ?? [],
      capabilitiesFile: prev?.capabilitiesFile ?? null,
      capabilitiesPath: prev?.capabilitiesPath ?? null,
      capabilitiesKey: prev?.capabilitiesKey ?? null,
      colors: { ...prev?.colors },
      ...(prev ? { block: prev.block, inline: prev.inline, caseSensitive: prev.caseSensitive } : {}),
    };
    for (const kind of ['block', 'inline'] as const) {
      const v = c[kind];
      if (v === undefined) continue;
      if (isStrings(v) && v.length === 2 && v.every((k) => /^[\w-]+$/.test(k))) next[kind] = [v[0], v[1]];
      else problem(`[conditions] ${kind} must be two keywords, like ${JSON.stringify(DEFAULT_CONDITIONS[kind])}`);
    }
    if (c.case_sensitive !== undefined) {
      if (typeof c.case_sensitive === 'boolean') next.caseSensitive = c.case_sensitive;
      else problem('[conditions] case_sensitive must be true or false');
    }
    if (c.capabilities !== undefined) {
      if (typeof c.capabilities !== 'string') problem('[conditions] capabilities must be the path of a JSON file');
      else {
        next.capabilitiesFile = c.capabilities;
        const key = typeof c.key === 'string' ? c.key : null;
        next.capabilitiesPath = /^([a-z]:)?[\\/]/i.test(c.capabilities) ? null : joinPath(file.split('/').slice(0, -1).join('/'), c.capabilities);
        next.capabilitiesKey = key;
        try {
          const json = JSON.parse(readCapabilities(c.capabilities));
          const names = capabilityNames(json, key);
          if (names) next.capabilities = names;
          else problem(`Couldn’t find a list of capabilities in ${c.capabilities}${key ? ` under "${key}"` : ''}`);
        } catch (e) {
          problem(`Couldn’t read ${c.capabilities}: ${e instanceof Error ? e.message : e}`);
        }
      }
    }
    if (c.colors !== undefined) {
      if (!isTable(c.colors)) problem('[conditions.colors] must be a table, like CapabilityX = "teal"');
      else {
        for (const [expr, color] of Object.entries(c.colors)) {
          if (typeof color === 'string' && ((CONDITION_PALETTE as readonly string[]).includes(color) || /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color))) next.colors[expr] = color;
          else problem(`[conditions.colors] "${expr}": use one of ${CONDITION_PALETTE.join(', ')}, or a colour like "#0a7f6f"`);
        }
      }
    }
    for (const key of Object.keys(c)) {
      if (!['enabled', 'block', 'inline', 'case_sensitive', 'capabilities', 'key', 'colors'].includes(key)) problem(`[conditions] unknown setting "${key}"`);
    }
    config.conditionSettings = next;
    config.conditions = enabled ? next : null;
  }
}

function readDirective(name: string, def: unknown, problem: (m: string) => void): DirectiveDef | null {
  const where = `[directives.${name}]`;
  if (!isTable(def)) {
    problem(`${where} must be a table`);
    return null;
  }
  const body = def.body ?? 'markdown';
  if (body !== 'markdown' && body !== 'text' && body !== 'none') {
    problem(`${where} body must be "markdown", "text" or "none"`);
    return null;
  }
  const d: DirectiveDef = { body, options: {}, insert: def.insert !== false };
  if (typeof def.label === 'string') d.label = def.label;
  if (def.tone !== undefined) {
    if (TONES.includes(def.tone as Tone)) d.tone = def.tone as Tone;
    else problem(`${where} tone must be one of ${TONES.join(', ')}`);
  }
  if (typeof def.argument === 'string') d.argument = def.argument;
  if (def.options !== undefined) {
    if (!isTable(def.options)) problem(`${where} options must be a table of option names`);
    else for (const [opt, o] of Object.entries(def.options)) {
      if (!isTable(o)) {
        problem(`${where} option "${opt}" must be a table`);
        continue;
      }
      const option: OptionDef = {};
      if (typeof o.label === 'string') option.label = o.label;
      if (typeof o.help === 'string') option.help = o.help;
      if (o.flag === true) option.flag = true;
      if (o.choices !== undefined) {
        if (isStrings(o.choices) && o.choices.length) option.choices = o.choices;
        else problem(`${where} option "${opt}": choices must be a list of strings`);
      }
      if (o.default !== undefined) option.default = String(o.default);
      d.options[opt] = option;
    }
  }
  return d;
}

// `p` relative to the folder `dir` (both with /), with . and .. resolved.
function joinPath(dir: string, p: string): string {
  const out: string[] = [];
  for (const part of `${dir}/${p}`.split(/[\\/]/)) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

// A name a condition can use (see conditions.ts: and, or and not are the syntax's).
export const isCapabilityName = (name: string) => /^[A-Za-z_][\w.:-]*$/.test(name) && !/^(and|or|not)$/i.test(name);

// The capabilities file's text with `name` added to its list, in the list's own shape
// (a name, an object with a name or id, or a key), and written the way the file is
// (its indentation, or on one line). Null when there's no list to add to.
export function addCapability(text: string, key: string | null, name: string): string | null {
  const json: unknown = JSON.parse(text);
  let list: unknown = json;
  if (key) {
    for (const part of key.split('.')) list = isTable(list) ? list[part] : undefined;
  } else if (isTable(list) && 'capabilities' in list) {
    list = list.capabilities;
  }
  if (capabilityNames(list, null)?.includes(name)) return text;
  if (isStrings(list)) list.push(name);
  else if (Array.isArray(list) && list.every(isTable)) {
    const field = list.length && 'id' in list[0] && !('name' in list[0]) ? 'id' : 'name';
    list.push({ [field]: name });
  } else if (isTable(list)) {
    const like = Object.values(list)[0];
    list[name] = typeof like === 'boolean' ? true : typeof like === 'string' ? '' : typeof like === 'number' ? 0 : isTable(like) ? {} : null;
  } else return null;
  const indent = text.trimEnd().includes('\n') ? (/\n([ \t]+)\S/.exec(text)?.[1] ?? 2) : undefined;
  return (indent === undefined ? JSON.stringify(json) : JSON.stringify(json, null, indent)) + (text.endsWith('\n') ? '\n' : '');
}

// Capability names from a JSON file whose exact shape isn't fixed: a list of names,
// a list of objects with a name/id, or an object keyed by name; optionally under `key`
// (dots for nesting), or under a "capabilities" key.
export function capabilityNames(json: unknown, key: string | null): string[] | null {
  let value = json;
  if (key) {
    for (const part of key.split('.')) value = isTable(value) ? value[part] : undefined;
  } else if (isTable(value) && 'capabilities' in value) {
    value = value.capabilities;
  }
  if (isStrings(value)) return value;
  if (Array.isArray(value)) {
    const names = value.map((v) => (isTable(v) ? (v.name ?? v.id) : undefined));
    return names.every((n) => typeof n === 'string') ? (names as string[]) : null;
  }
  if (isTable(value)) return Object.keys(value);
  return null;
}
