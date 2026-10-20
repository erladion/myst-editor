// Work out which Python packages a project's documentation build needs.
//
// In order of preference:
//   1. .readthedocs.yaml: what the project's published docs are actually built with
//   2. a docs requirements file in one of the usual places
//   3. a "docs" extra in pyproject.toml
//   4. packages inferred from conf.py's extensions and theme
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parse as parseToml } from 'smol-toml';

export interface EnvPlan {
  python: string; // version request for uv, e.g. "3.12"
  requirements: string[]; // absolute paths of requirements files
  editable: { path: string; extras: string[] }[]; // `pip install -e path[extras]`
  packages: string[];
  description: string; // for the writer: where the requirements came from
}

const DEFAULT_PYTHON = '3.12';

// Import name → PyPI name for common extensions and themes.
const KNOWN_PACKAGES: Record<string, string> = {
  myst_parser: 'myst-parser',
  myst_nb: 'myst-nb',
  sphinx_design: 'sphinx-design',
  sphinx_copybutton: 'sphinx-copybutton',
  sphinx_togglebutton: 'sphinx-togglebutton',
  sphinx_tabs: 'sphinx-tabs',
  sphinx_inline_tabs: 'sphinx-inline-tabs',
  sphinx_autodoc_typehints: 'sphinx-autodoc-typehints',
  sphinx_exercise: 'sphinx-exercise',
  sphinx_proof: 'sphinx-proof',
  sphinx_external_toc: 'sphinx-external-toc',
  sphinx_thebe: 'sphinx-thebe',
  sphinx_sitemap: 'sphinx-sitemap',
  sphinx_reredirects: 'sphinx-reredirects',
  sphinx_click: 'sphinx-click',
  sphinx_favicon: 'sphinx-favicon',
  sphinx_last_updated_by_git: 'sphinx-last-updated-by-git',
  sphinxcontrib_mermaid: 'sphinxcontrib-mermaid',
  'sphinxcontrib.mermaid': 'sphinxcontrib-mermaid',
  'sphinxcontrib.bibtex': 'sphinxcontrib-bibtex',
  'sphinxcontrib.plantuml': 'sphinxcontrib-plantuml',
  'sphinxcontrib.httpdomain': 'sphinxcontrib-httpdomain',
  'sphinxcontrib.openapi': 'sphinxcontrib-openapi',
  'sphinxcontrib.programoutput': 'sphinxcontrib-programoutput',
  'sphinxext.opengraph': 'sphinxext-opengraph',
  'sphinxext.rediraffe': 'sphinxext-rediraffe',
  notfound: 'sphinx-notfound-page',
  'notfound.extension': 'sphinx-notfound-page',
  autoapi: 'sphinx-autoapi',
  'autoapi.extension': 'sphinx-autoapi',
  linuxdoc: 'linuxdoc',
  breathe: 'breathe',
  nbsphinx: 'nbsphinx',
  furo: 'furo',
  sphinx_rtd_theme: 'sphinx-rtd-theme',
  pydata_sphinx_theme: 'pydata-sphinx-theme',
  sphinx_book_theme: 'sphinx-book-theme',
  sphinx_immaterial: 'sphinx-immaterial',
  sphinx_material: 'sphinx-material',
  piccolo_theme: 'piccolo-theme',
  shibuya: 'shibuya',
  alabaster: 'alabaster',
};

// Files that usually hold documentation requirements, relative to the project root.
const ROOT_REQUIREMENTS = [
  'requirements-docs.txt',
  'requirements_docs.txt',
  'docs-requirements.txt',
  'doc-requirements.txt',
  'requirements/docs.txt',
  'requirements/doc.txt',
];

export function planEnvironment(root: string, sourceDir: string): EnvPlan {
  const rel = (p: string) => relative(root, p).split(sep).join('/') || '.';
  const python = pythonVersion(root);

  // 1. Read the Docs configuration.
  for (const name of ['.readthedocs.yaml', '.readthedocs.yml']) {
    const path = join(root, name);
    if (!existsSync(path)) continue;
    try {
      const config = parseYaml(readFileSync(path, 'utf8')) ?? {};
      const plan: EnvPlan = { python: rtdPython(config) ?? python, requirements: [], editable: [], packages: [], description: name };
      for (const item of config?.python?.install ?? []) {
        if (typeof item?.requirements === 'string') {
          const req = resolve(root, item.requirements);
          if (existsSync(req)) plan.requirements.push(req);
        } else if (item?.method === 'pip' || item?.method === 'setuptools') {
          plan.editable.push({ path: resolve(root, item.path ?? '.'), extras: item.extra_requirements ?? [] });
        }
      }
      if (plan.requirements.length || plan.editable.length) return plan;
    } catch {
      // unreadable YAML: fall through to the other sources
    }
  }

  // 2. A requirements file next to conf.py, in its parent docs folder, or at the root.
  const docsDirs = [sourceDir, dirname(sourceDir)].filter((d) => d === root || d.startsWith(root + sep));
  const candidates = [
    ...docsDirs.flatMap((d) => (d === root ? [] : ['requirements.txt', 'requirements-docs.txt'].map((f) => join(d, f)))),
    ...ROOT_REQUIREMENTS.map((f) => join(root, f)),
  ];
  const requirements = [...new Set(candidates)].filter(existsSync);
  if (requirements.length) {
    return { python, requirements, editable: [], packages: [], description: requirements.map(rel).join(', ') };
  }

  // 3. A docs extra in pyproject.toml.
  const pyproject = join(root, 'pyproject.toml');
  if (existsSync(pyproject)) {
    try {
      const toml = parseToml(readFileSync(pyproject, 'utf8')) as { project?: { 'optional-dependencies'?: Record<string, unknown> } };
      const extras = Object.keys(toml.project?.['optional-dependencies'] ?? {}).filter((e) => /^docs?$|^documentation$/.test(e));
      if (extras.length) {
        return { python, requirements: [], editable: [{ path: root, extras }], packages: [], description: `pyproject.toml [${extras.join(', ')}]` };
      }
    } catch {
      // ignore malformed pyproject.toml
    }
  }

  // 4. Infer from conf.py.
  const conf = join(sourceDir, 'conf.py');
  const packages = ['sphinx', 'myst-parser', ...(existsSync(conf) ? inferPackages(readFileSync(conf, 'utf8')) : [])];
  return { python, requirements: [], editable: [], packages: [...new Set(packages)], description: 'guessed from conf.py' };
}

// Packages for the extensions and theme a conf.py names, where we know them.
export function inferPackages(confPy: string): string[] {
  const names: string[] = [];
  const list = /^\s*extensions\s*(?:\+?=)\s*[[(]([^\])]*)[\])]/gm;
  for (const m of confPy.matchAll(list)) names.push(...[...m[1].matchAll(/["']([\w.]+)["']/g)].map((x) => x[1]));
  for (const m of confPy.matchAll(/extensions\s*\.\s*(?:append|extend)\(\s*[[(]?\s*["']([\w.]+)["']/g)) names.push(m[1]);
  const theme = /^\s*html_theme\s*=\s*["']([\w.-]+)["']/m.exec(confPy)?.[1];
  if (theme) names.push(theme);
  return names.map((n) => KNOWN_PACKAGES[n] ?? KNOWN_PACKAGES[n.split('.')[0]]).filter((p): p is string => !!p);
}

function pythonVersion(root: string): string {
  const file = join(root, '.python-version');
  if (existsSync(file)) {
    const v = readFileSync(file, 'utf8').trim().split('\n')[0].trim();
    if (/^\d+\.\d+/.test(v)) return v;
  }
  return DEFAULT_PYTHON;
}

function rtdPython(config: { build?: { tools?: { python?: unknown } } }): string | null {
  const v = String(config?.build?.tools?.python ?? '');
  return /^\d+\.\d+/.test(v) ? v : null;
}
