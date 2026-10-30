// Antora: a documentation component, described by its antora.yml, whose pages are in
// modules: modules/<module>/pages/, with the module's partials, examples and images
// beside them, and navigation files that list the pages.
//
// Pages refer to these by resource ID rather than by path:
// [version@][component:][module:][family$]path[#fragment]. A page's own module and
// family need not be said: xref:install.adoc[] is the module's pages/install.adoc,
// image::logo.svg[] its images/logo.svg, include::partial$note.adoc[] its
// partials/note.adoc. Paths are from the family's folder, not from the page's own.
import { parse as parseYaml } from 'yaml';
import { relativePath } from '../rename.js';

export interface Antora {
  root: string; // the component's folder, from the opened folder ('' when it is the opened folder)
  name: string;
  version: string | null; // null: versionless (~)
  title: string | null;
  nav: string[]; // its navigation files, relative to the component
  startPage: string | null; // a resource ID; null: ROOT's index.adoc
}

export type Family = 'page' | 'partial' | 'example' | 'image' | 'attachment';

const FOLDERS: Record<Family, string> = { page: 'pages', partial: 'partials', example: 'examples', image: 'images', attachment: 'attachments' };
const FAMILY_OF: Record<string, Family> = Object.fromEntries(Object.entries(FOLDERS).map(([f, d]) => [d, f as Family]));

// What antora.yml says, and the attributes it sets for every page (null: it isn't a
// component's).
export function readComponent(text: string, root: string): { antora: Antora; attributes: Record<string, string> } | null {
  let yml: unknown;
  try {
    yml = parseYaml(text);
  } catch {
    return null;
  }
  if (!yml || typeof yml !== 'object') return null;
  const y = yml as Record<string, unknown>;
  if (typeof y.name !== 'string' || !y.name) return null;
  const attributes: Record<string, string> = {};
  const given = (y.asciidoc as { attributes?: unknown } | undefined)?.attributes;
  if (given && typeof given === 'object') {
    for (const [k, v] of Object.entries(given as Record<string, unknown>)) {
      // true: set; false and null: unset; "value@": set, a page may set it differently.
      if (v === false || v === null || v === undefined) continue;
      attributes[k] = v === true ? '' : String(v);
    }
  }
  const nav = Array.isArray(y.nav) ? y.nav.filter((n): n is string => typeof n === 'string') : [];
  const version = y.version === null || y.version === undefined || y.version === '~' ? null : String(y.version);
  return {
    antora: { root, name: y.name, version, title: typeof y.title === 'string' ? y.title : null, nav, startPage: typeof y.start_page === 'string' ? y.start_page : null },
    attributes,
  };
}

// A value set in antora.yml, as it reads (without a trailing @, which lets pages set it).
export const attributeValue = (v: string) => v.replace(/@$/, '');

export interface ResourceId {
  version: string | null;
  component: string | null;
  module: string | null;
  family: Family | null;
  path: string;
  fragment: string | null;
}

// A resource ID's parts; null for a URL, or what isn't one.
export function parseResourceId(spec: string): ResourceId | null {
  if (!spec || /^[a-z][\w+.-]*:\/\//i.test(spec) || /^(data|mailto|tel|irc):/i.test(spec) || spec.startsWith('/') || spec.startsWith('{')) return null;
  let rest = spec;
  let fragment: string | null = null;
  const hash = rest.indexOf('#');
  if (hash >= 0) {
    fragment = rest.slice(hash + 1);
    rest = rest.slice(0, hash);
  }
  let version: string | null = null;
  const at = rest.indexOf('@');
  if (at >= 0) {
    version = rest.slice(0, at);
    rest = rest.slice(at + 1);
  }
  const parts = rest.split(':');
  if (parts.length > 3) return null;
  let component: string | null = null;
  let module: string | null = null;
  if (parts.length === 3) {
    component = parts[0] || null;
    module = parts[1] || 'ROOT';
  } else if (parts.length === 2) {
    if (!parts[0]) return null;
    module = parts[0];
  }
  let path = parts[parts.length - 1];
  let family: Family | null = null;
  const dollar = /^([a-z]+)\$/.exec(path);
  if (dollar) {
    if (!(dollar[1] in FOLDERS)) return null;
    family = dollar[1] as Family;
    path = path.slice(dollar[0].length);
  }
  return { version, component, module, family, path, fragment };
}

// Where a file is in the component (relative to it): its module and family, and its
// folder within the family's. Null outside the modules.
export interface Place {
  module: string;
  family: Family | null; // null: a navigation file, or another file in the module
  dir: string;
}

export function placeOf(file: string): Place | null {
  const m = /^modules\/([^/]+)\/(.*)$/.exec(file);
  if (!m) return null;
  const f = /^([a-z]+)\/(.*)$/.exec(m[2]);
  const family = f ? FAMILY_OF[f[1]] : undefined;
  if (!f || !family) return { module: m[1], family: null, dir: '' };
  return { module: m[1], family, dir: dirOf(f[2]) };
}

// The file `spec` names, written in `from` (both relative to the component), with
// `family` when it doesn't say; null if it's another component's, or not a file in
// a family. A page's ./path is from its own folder.
export function resolveResource(antora: Antora, from: string, spec: string, family: Family): { file: string; fragment: string | null } | null {
  const id = parseResourceId(spec);
  if (!id) return null;
  if (id.component && id.component !== antora.name) return null;
  if (id.version && id.version !== (antora.version ?? '~')) return null;
  const place = placeOf(from) ?? { module: 'ROOT', family: null, dir: '' };
  const fam = id.family ?? family;
  if (fam === 'page' && !/\.adoc$/.test(id.path)) return null; // an anchor's name
  let path = id.path;
  if (path.startsWith('./') && !id.module && fam === place.family) path = join(place.dir, path.slice(2));
  const normal = normalize(path);
  if (normal === null) return null;
  return { file: `modules/${id.module ?? place.module}/${FOLDERS[fam]}/${normal}`, fragment: id.fragment };
}

// How `from` names `file` (both relative to the component): the shortest resource ID,
// with the module if `qualified`, or if it's another's; ./path if `relative` and it's
// in the page's folder or below. Null if `file` isn't in `family`.
export function resourceIdFor(from: string, file: string, family: Family, opts: { qualified?: boolean; relative?: boolean; implied?: Family } = {}): string | null {
  const target = placeOf(file);
  if (!target || target.family !== family) return null;
  const path = file.slice(`modules/${target.module}/${FOLDERS[family]}/`.length);
  const here = placeOf(from);
  const sameModule = (here?.module ?? 'ROOT') === target.module;
  const prefix = family === (opts.implied ?? family) ? '' : `${family}$`;
  if (opts.relative && sameModule && here?.family === family) {
    const rel = relativePath(here.dir, path);
    if (!rel.startsWith('../')) return `./${rel}`;
  }
  return `${sameModule && !opts.qualified ? '' : `${target.module}:`}${prefix}${path}`;
}

// Whether a spec says its module, or is written from the page's folder.
export const specStyle = (spec: string) => {
  const id = parseResourceId(spec);
  return { qualified: !!id?.module, relative: !!id?.path.startsWith('./') };
};

// A path's folder: "a/b/c.adoc" → "a/b"; "c.adoc" → "".
export const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

function normalize(path: string): string | null {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!out.length) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join('/');
}

const join = (dir: string, path: string) => (dir ? `${dir}/${path}` : path);

// A page of the component: in a module's pages, and not hidden (Antora leaves out
// files and folders whose names start with _ or .).
export function isComponentPage(file: string): boolean {
  const m = /^modules\/[^/]+\/pages\/(.+\.adoc)$/.exec(file);
  return !!m && !m[1].split('/').some((p) => p.startsWith('_') || p.startsWith('.'));
}

// The component's start page, relative to it.
export function startPageOf(antora: Antora): string {
  return (antora.startPage && resolveResource(antora, 'modules/ROOT/pages/index.adoc', antora.startPage, 'page')?.file) || 'modules/ROOT/pages/index.adoc';
}
