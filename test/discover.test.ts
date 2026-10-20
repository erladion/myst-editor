import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inferPackages, planEnvironment } from '../src/main/sphinx/discover.js';

function project(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'mysteditor-discover-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

describe('planEnvironment', () => {
  it('prefers .readthedocs.yaml', () => {
    const root = project({
      '.readthedocs.yaml': 'version: 2\nbuild:\n  tools:\n    python: "3.11"\npython:\n  install:\n    - requirements: docs/requirements.txt\n    - method: pip\n      path: .\n      extra_requirements: [docs]\n',
      'docs/requirements.txt': 'sphinx\n',
      'docs/conf.py': '',
    });
    const plan = planEnvironment(root, join(root, 'docs'));
    expect(plan).toEqual({
      python: '3.11',
      requirements: [join(root, 'docs/requirements.txt')],
      editable: [{ path: root, extras: ['docs'] }],
      packages: [],
      description: '.readthedocs.yaml',
    });
  });

  it('finds requirements next to conf.py or in the parent docs folder', () => {
    const root = project({ 'docs/requirements.txt': 'sphinx\n', 'docs/source/conf.py': '', '.python-version': '3.13\n' });
    const plan = planEnvironment(root, join(root, 'docs/source'));
    expect(plan.requirements).toEqual([join(root, 'docs/requirements.txt')]);
    expect(plan.python).toBe('3.13');
    expect(plan.description).toBe('docs/requirements.txt');
  });

  it('does not treat the application requirements.txt at the root as docs requirements', () => {
    const root = project({ 'requirements.txt': 'django\n', 'conf.py': 'extensions = ["myst_parser"]\n' });
    expect(planEnvironment(root, root).description).toBe('guessed from conf.py');
  });

  it('uses a docs extra from pyproject.toml', () => {
    const root = project({ 'pyproject.toml': '[project]\nname = "x"\n[project.optional-dependencies]\ndocs = ["sphinx"]\ntest = ["pytest"]\n', 'docs/conf.py': '' });
    expect(planEnvironment(root, join(root, 'docs')).editable).toEqual([{ path: root, extras: ['docs'] }]);
  });

  it('falls back to packages inferred from conf.py', () => {
    const root = project({ 'docs/conf.py': 'extensions = ["myst_parser", "sphinx_design", "sphinx.ext.autodoc", "my_local_ext"]\nhtml_theme = "furo"\n' });
    expect(planEnvironment(root, join(root, 'docs')).packages).toEqual(['sphinx', 'myst-parser', 'sphinx-design', 'furo']);
  });
});

describe('inferPackages', () => {
  it('handles appends and dotted names', () => {
    expect(inferPackages('extensions = []\nextensions.append("sphinxcontrib.mermaid")\nhtml_theme = "sphinx_rtd_theme"\n')).toEqual([
      'sphinxcontrib-mermaid',
      'sphinx-rtd-theme',
    ]);
  });
});
