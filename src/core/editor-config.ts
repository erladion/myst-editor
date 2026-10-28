// Per-project editor settings from `.wysie.toml`: how to present a project's own
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
//
//   [pdf]                                # File → Export PDF
//   paper = "A4"                         # A4 | Letter
//   logo = "_static/logo.svg"            # relative to this file: on the cover, and {logo}
//   title = "Harbor manual"              # the cover; default: the root page's title
//   subtitle = "Version {version}, {date}"
//   note = "© Example AB"                # at the foot of the cover
//   cover_background = "_static/cover.png"   # fills the whole cover page
//   cover_color = "#ffffff"              # the cover's text, on a dark background
//   [pdf.cover.title]                    # where the title goes (logo, title, subtitle, note):
//   x = 20                               # mm from the page's top left; width in mm
//   y = 120                              # size (pt) and align (left, center, right): texts
//   cover_images = [                     # graphics on the cover; mm from its top left
//     { file = "_static/badge.svg", x = 150, y = 240, width = 40 },   # height optional
//   ]
//   font = "Source Serif 4"              # the text: a font in fonts, or on the computer
//   heading_font = "Source Sans 3"       # headings and the cover's title; default: font
//   code_font = "JetBrains Mono"
//   fonts = ["_static/fonts/SourceSerif4-Regular.ttf"]   # font files, the same everywhere
//   header = ["{logo}", "", "{chapter}"] # left, centre, right
//   footer = ["", "{page}", ""]          # {page} {pages} {chapter} {title} {date} {version} {release} {logo}
//   headers_on = "numbered"              # numbered pages | not-cover | all (the cover too);
//                                        # slots with {page} or {pages} stay empty where there's no number
//   numbering = "content"                # content: from the first page after the contents | cover
//   toc_depth = 2                        # levels in the contents
//   site_css = false                     # leave out conf.py's html_css_files (default: kept)
//   css = "_static/pdf.css"              # a stylesheet for the PDF only, applied last
//   [pdf.variables]                      # {name} in the headers, footers and cover, as
//   classification = "Internal"          # are author, copyright and html_context from conf.py
import { parse as parseToml } from 'smol-toml';
import { appendToJson, jsonLike } from './json-edit.js';

// The name new settings files get; a folder's may also have an earlier name (see
// shared/product.ts).
export { SETTINGS_FILES, isSettingsFile } from '../shared/product.js';
export const SETTINGS_FILE = '.wysie.toml';

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

// How pages write conditions' markers: MyST's HTML comments, AsciiDoc's ifdef
// (see conditions.ts).
export type MarkerKind = 'comments' | 'ifdef';

export interface ConditionsDef {
  block: [string, string];
  inline: [string, string];
  markers?: MarkerKind; // 'comments' if not said
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

export type PaperSize = 'A4' | 'Letter';
export const PAPER_SIZES: PaperSize[] = ['A4', 'Letter'];
// In mm.
export const PAPER_MM: Record<PaperSize, { width: number; height: number }> = { A4: { width: 210, height: 297 }, Letter: { width: 215.9, height: 279.4 } };
// The PDF's margins (mm): headers and footers are drawn in them. The cover has none
// (its background reaches the edges), and its text keeps to these.
export const PDF_MARGIN_MM = { top: 22, bottom: 20, side: 20 };

// A graphic on the cover, in mm from the page's top-left corner.
export interface CoverImage {
  file: string; // as written (relative to the settings file)
  path: string | null; // relative to the opened folder; null when it can't be told
  x: number;
  y: number;
  width: number;
  height: number | null; // null: as the image's shape makes it
}

// What on the cover can be moved, and where it is when it has been: mm from the page's
// top-left corner; for the texts, their size (pt) and alignment.
export const COVER_PARTS = ['logo', 'title', 'subtitle', 'note'] as const;
export type CoverPart = (typeof COVER_PARTS)[number];
export interface CoverPlace {
  x: number;
  y: number;
  width: number | null; // null: to the right margin (a text), or as large as usual (the logo)
  size: number | null; // pt; null: as usual
  align: 'left' | 'center' | 'right' | null;
}

// How File → Export PDF lays out the project.
export interface PdfDef {
  paper: PaperSize;
  logo: string | null; // as written (relative to the settings file)
  logoPath: string | null; // relative to the opened folder; null when it can't be told
  title: string | null; // null: the root page's title
  subtitle: string;
  note: string;
  coverBackground: string | null; // as written
  coverBackgroundPath: string | null; // relative to the opened folder
  coverColor: string | null; // null: the usual dark text
  coverImages: CoverImage[];
  cover: Partial<Record<CoverPart, CoverPlace>>; // the parts moved from their usual places
  font: string | null; // family names; null: the usual
  headingFont: string | null; // null: as font
  codeFont: string | null;
  fonts: { file: string; path: string | null }[]; // font files: as written, and relative to the opened folder
  header: [string, string, string];
  footer: [string, string, string];
  // Where headers and footers are: the numbered pages (but the cover), every page but
  // the cover, or every page.
  headersOn: 'numbered' | 'not-cover' | 'all';
  numbering: 'content' | 'cover';
  tocDepth: number;
  siteCss: boolean; // the stylesheets conf.py adds to the website (html_css_files, html_style)
  css: string | null; // the PDF's own stylesheet, as written
  cssPath: string | null; // relative to the opened folder
  variables: Record<string, string>; // the PDF's own {name}s
}

// The PDF's own placeholders: variables can't have these names.
export const PDF_PLACEHOLDERS = ['page', 'pages', 'chapter', 'title', 'date', 'version', 'release', 'project', 'logo'];

export const DEFAULT_PDF: PdfDef = {
  paper: 'A4',
  logo: null,
  logoPath: null,
  title: null,
  subtitle: '{date}',
  note: '',
  coverBackground: null,
  coverBackgroundPath: null,
  coverColor: null,
  coverImages: [],
  cover: {},
  font: null,
  headingFont: null,
  codeFont: null,
  fonts: [],
  header: ['', '', '{chapter}'],
  footer: ['', '{page}', ''],
  headersOn: 'numbered',
  numbering: 'content',
  tocDepth: 2,
  siteCss: true,
  css: null,
  cssPath: null,
  variables: {},
};

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
  pdf: PdfDef;
  problems: SettingsProblem[];
}

// A name a process environment can hold (and a shell would accept).
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const EMPTY_EDITOR_CONFIG: EditorConfig = { directives: {}, roles: {}, tables: {}, conditions: null, conditionSettings: null, sphinxEnv: {}, pdf: DEFAULT_PDF, problems: [] };

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
  const config: EditorConfig = { directives: {}, roles: {}, tables: {}, conditions: null, conditionSettings: null, sphinxEnv: {}, pdf: DEFAULT_PDF, problems: [] };
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
    if (!['directives', 'roles', 'tables', 'conditions', 'sphinx', 'pdf'].includes(key)) problem(`Unknown section [${key}] (expected directives, roles, tables, conditions, sphinx or pdf)`);
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

  if (raw.pdf !== undefined) {
    if (!isTable(raw.pdf)) problem('[pdf] must be a table');
    else config.pdf = readPdf(raw.pdf, config.pdf, file, problem);
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

function readPdf(t: Raw, prev: PdfDef, file: string, problem: (m: string) => void): PdfDef {
  const pdf: PdfDef = { ...prev };
  const text = (key: string, set: (v: string) => void) => {
    if (t[key] === undefined) return;
    if (typeof t[key] === 'string') set(t[key] as string);
    else problem(`[pdf] ${key} must be text`);
  };
  if (t.paper !== undefined) {
    if (PAPER_SIZES.includes(t.paper as PaperSize)) pdf.paper = t.paper as PaperSize;
    else problem(`[pdf] paper must be ${PAPER_SIZES.join(' or ')}`);
  }
  // A file named in the settings, relative to the opened folder (null if absolute).
  const near = (v: string) => (!v || /^([a-z]:)?[\\/]/i.test(v) ? null : joinPath(file.split('/').slice(0, -1).join('/'), v));
  text('logo', (v) => {
    pdf.logo = v || null;
    pdf.logoPath = near(v);
  });
  text('cover_background', (v) => {
    pdf.coverBackground = v || null;
    pdf.coverBackgroundPath = near(v);
  });
  text('cover_color', (v) => {
    if (!v || /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v) || /^[a-z]+$/i.test(v)) pdf.coverColor = v || null;
    else problem(`[pdf] cover_color must be a colour, like "#ffffff" or "white"`);
  });
  text('font', (v) => (pdf.font = v.trim() || null));
  text('heading_font', (v) => (pdf.headingFont = v.trim() || null));
  text('code_font', (v) => (pdf.codeFont = v.trim() || null));
  if (t.fonts !== undefined) {
    if (isStrings(t.fonts) && t.fonts.every((f) => /\.(ttf|otf|woff2?)$/i.test(f))) pdf.fonts = t.fonts.map((f) => ({ file: f, path: near(f) }));
    else problem('[pdf] fonts must be a list of font files (.ttf, .otf, .woff or .woff2)');
  }
  if (t.cover !== undefined) {
    const mm = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= -1000 && v <= 1000;
    if (!isTable(t.cover)) problem('[pdf.cover] must be tables: [pdf.cover.title] and so on');
    else {
      pdf.cover = { ...pdf.cover };
      for (const [part, place] of Object.entries(t.cover)) {
        const where = `[pdf.cover.${part}]`;
        if (!(COVER_PARTS as readonly string[]).includes(part)) {
          problem(`${where}: the cover’s parts are ${COVER_PARTS.join(', ')}`);
          continue;
        }
        if (isTable(place) && !Object.keys(place).length) continue; // an empty table: not moved
        if (!isTable(place) || !mm(place.x) || !mm(place.y)) {
          problem(`${where}: x and y are numbers of mm`);
          continue;
        }
        if ((place.width !== undefined && !mm(place.width)) || (place.size !== undefined && !(typeof place.size === 'number' && place.size > 0 && place.size <= 200))) {
          problem(`${where}: width is mm, and size is points`);
          continue;
        }
        if (place.align !== undefined && !['left', 'center', 'right'].includes(place.align as string)) {
          problem(`${where}: align is left, center or right`);
          continue;
        }
        pdf.cover[part as CoverPart] = {
          x: place.x as number,
          y: place.y as number,
          width: (place.width as number | undefined) ?? null,
          size: (place.size as number | undefined) ?? null,
          align: (place.align as CoverPlace['align'] | undefined) ?? null,
        };
      }
    }
  }
  if (t.cover_images !== undefined) {
    const list = t.cover_images;
    const mm = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= -1000 && v <= 1000;
    if (!Array.isArray(list)) problem('[pdf] cover_images must be a list, like [{ file = "badge.svg", x = 20, y = 200, width = 40 }]');
    else {
      pdf.coverImages = [];
      list.forEach((img, i) => {
        const where = `[pdf] cover_images, number ${i + 1}`;
        if (!isTable(img) || typeof img.file !== 'string' || !img.file) return problem(`${where}: needs a file`);
        if (![img.x, img.y, img.width].every(mm) || (img.height !== undefined && !mm(img.height))) return problem(`${where}: x, y, width (and height) are numbers of mm`);
        pdf.coverImages.push({ file: img.file, path: near(img.file), x: img.x as number, y: img.y as number, width: img.width as number, height: img.height === undefined ? null : (img.height as number) });
      });
    }
  }
  text('title', (v) => (pdf.title = v || null));
  text('subtitle', (v) => (pdf.subtitle = v));
  text('note', (v) => (pdf.note = v));
  for (const key of ['header', 'footer'] as const) {
    const v = t[key];
    if (v === undefined) continue;
    if (isStrings(v) && v.length === 3) pdf[key] = [v[0], v[1], v[2]];
    else problem(`[pdf] ${key} must be three texts (left, centre, right), like ["", "{page}", ""]`);
  }
  if (t.headers_on !== undefined) {
    if (t.headers_on === 'numbered' || t.headers_on === 'not-cover' || t.headers_on === 'all') pdf.headersOn = t.headers_on;
    else problem('[pdf] headers_on must be "numbered", "not-cover" or "all"');
  }
  if (t.numbering !== undefined) {
    if (t.numbering === 'content' || t.numbering === 'cover') pdf.numbering = t.numbering;
    else problem('[pdf] numbering must be "content" or "cover"');
  }
  if (t.toc_depth !== undefined) {
    if (Number.isInteger(t.toc_depth) && (t.toc_depth as number) >= 1 && (t.toc_depth as number) <= 4) pdf.tocDepth = t.toc_depth as number;
    else problem('[pdf] toc_depth must be 1, 2, 3 or 4');
  }
  if (t.site_css !== undefined) {
    if (typeof t.site_css === 'boolean') pdf.siteCss = t.site_css;
    else problem('[pdf] site_css must be true or false');
  }
  text('css', (v) => {
    if (v && !/\.css$/i.test(v)) return problem('[pdf] css must be a stylesheet (.css)');
    pdf.css = v || null;
    pdf.cssPath = near(v);
  });
  if (t.variables !== undefined) {
    if (!isTable(t.variables)) problem('[pdf.variables] must be a table, like classification = "Internal"');
    else {
      pdf.variables = { ...pdf.variables };
      for (const [name, value] of Object.entries(t.variables)) {
        if (!/^\w+$/.test(name)) problem(`[pdf.variables] ${name}: names are letters, digits and _`);
        else if (PDF_PLACEHOLDERS.includes(name)) problem(`[pdf.variables] ${name} is one of the PDF’s own placeholders`);
        else if (typeof value === 'string' || typeof value === 'number') pdf.variables[name] = String(value);
        else problem(`[pdf.variables] ${name} must be text`);
      }
    }
  }
  for (const key of Object.keys(t)) {
    if (!['paper', 'logo', 'title', 'subtitle', 'note', 'cover_background', 'cover_color', 'cover_images', 'cover', 'font', 'heading_font', 'code_font', 'fonts', 'headers_on', 'header', 'footer', 'numbering', 'toc_depth', 'site_css', 'css', 'variables'].includes(key)) problem(`[pdf] unknown setting "${key}"`);
  }
  return pdf;
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
// `p` relative to `dir`, both inside the opened folder; null when it climbs out of it.
function joinPath(dir: string, p: string): string | null {
  const out: string[] = [];
  for (const part of `${dir}/${p}`.split(/[\\/]/)) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!out.length) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join('/');
}

// A name a condition can use (see conditions.ts: and, or and not are the syntax's).
export const isCapabilityName = (name: string) => /^[A-Za-z_][\w.:-]*$/.test(name) && !/^(and|or|not)$/i.test(name);

// The capabilities file's text with `name` added to its list, in the list's own shape
// (a name, an object with a name or id, or a key). Only the new entry is written: the
// rest of the file stays as it is. Null when there's no list to add to.
export function addCapability(text: string, key: string | null, name: string): string | null {
  const json: unknown = JSON.parse(text);
  const path = key ? key.split('.') : isTable(json) && 'capabilities' in json ? ['capabilities'] : [];
  let list: unknown = json;
  for (const part of path) list = isTable(list) ? list[part] : undefined;
  if (capabilityNames(list, null)?.includes(name)) return text;
  if (isStrings(list)) return appendToJson(text, path, () => JSON.stringify(name));
  if (Array.isArray(list) && list.every(isTable)) {
    const field = list.length && 'id' in list[0] && !('name' in list[0]) ? 'id' : 'name';
    return appendToJson(text, path, (style) => jsonLike({ [field]: name }, style));
  }
  if (isTable(list)) {
    const like = Object.values(list)[0];
    const value = typeof like === 'boolean' ? true : typeof like === 'string' ? '' : typeof like === 'number' ? 0 : isTable(like) ? {} : null;
    return appendToJson(text, path, (style) => `${JSON.stringify(name)}${style.colon}${JSON.stringify(value)}`);
  }
  return null;
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
