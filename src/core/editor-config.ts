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
//   [conditions]
//   capabilities = "capabilities.json"   # relative to this file
//   block = ["if", "endif"]
//   inline = ["if-inline", "endif-inline"]
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
}

export interface SettingsProblem {
  file: string; // relative to the opened folder
  message: string;
}

export interface EditorConfig {
  directives: Record<string, DirectiveDef>;
  roles: Record<string, RoleDef>;
  conditions: ConditionsDef | null;
  problems: SettingsProblem[];
}

export const EMPTY_EDITOR_CONFIG: EditorConfig = { directives: {}, roles: {}, conditions: null, problems: [] };

const DEFAULT_CONDITIONS: Omit<ConditionsDef, 'capabilities' | 'capabilitiesFile'> = {
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
  const config: EditorConfig = { directives: {}, roles: {}, conditions: null, problems: [] };
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
    if (!['directives', 'roles', 'conditions'].includes(key)) problem(`Unknown section [${key}] (expected directives, roles or conditions)`);
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
    const prev = config.conditions;
    const next: ConditionsDef = {
      ...DEFAULT_CONDITIONS,
      capabilities: prev?.capabilities ?? [],
      capabilitiesFile: prev?.capabilitiesFile ?? null,
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
        try {
          const json = JSON.parse(readCapabilities(c.capabilities));
          const key = typeof c.key === 'string' ? c.key : null;
          const names = capabilityNames(json, key);
          if (names) next.capabilities = names;
          else problem(`Couldn’t find a list of capabilities in ${c.capabilities}${key ? ` under "${key}"` : ''}`);
        } catch (e) {
          problem(`Couldn’t read ${c.capabilities}: ${e instanceof Error ? e.message : e}`);
        }
      }
    }
    for (const key of Object.keys(c)) {
      if (!['block', 'inline', 'case_sensitive', 'capabilities', 'key'].includes(key)) problem(`[conditions] unknown setting "${key}"`);
    }
    config.conditions = next;
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
