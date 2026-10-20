import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { firstHeading, listDocuments, openProject, resolveInside } from '../src/main/project.js';

function project() {
  const root = mkdtempSync(join(tmpdir(), 'mysteditor-test-'));
  mkdirSync(join(root, 'docs', 'guide'), { recursive: true });
  mkdirSync(join(root, 'docs', '_build'));
  mkdirSync(join(root, 'outside'));
  writeFileSync(join(root, 'docs', 'conf.py'), 'myst_enable_extensions = ["colon_fence"]\n');
  writeFileSync(join(root, 'docs', 'index.md'), '---\ntitle: x\n---\n# Home *page*\n');
  writeFileSync(join(root, 'docs', 'guide', 'a.md'), '```\n# not a title\n```\n\nSetext title\n============\n');
  writeFileSync(join(root, 'docs', '_build', 'junk.md'), '# built\n');
  writeFileSync(join(root, 'outside', 'secret.md'), 'secret');
  return root;
}

describe('openProject', () => {
  it('finds conf.py in docs/, reads its MyST extensions and lists pages with titles', async () => {
    const root = project();
    const p = await openProject(root);
    expect(p.sourceDir).toBe(join(p.root, 'docs'));
    expect(p.confPy).toBe(join('docs', 'conf.py'));
    expect(p.config.extensions).toEqual(['colon_fence']);
    expect(p.files).toEqual(['guide/a.md', 'index.md']);
    expect(p.titles).toEqual({ 'index.md': 'Home page', 'guide/a.md': 'Setext title' });
  });

  it('skips build output', async () => {
    expect(await listDocuments(join(project(), 'docs'))).not.toContain('_build/junk.md');
  });
});

describe('resolveInside', () => {
  it('allows paths inside the base, including new files', () => {
    const base = join(project(), 'docs');
    expect(resolveInside(base, 'guide/a.md')).toBe(join(base, 'guide', 'a.md'));
    expect(resolveInside(base, 'guide/new/page.md')).toBe(join(base, 'guide', 'new', 'page.md'));
  });

  it('refuses paths and symlinks that escape the base', () => {
    const root = project();
    const base = join(root, 'docs');
    expect(() => resolveInside(base, '../outside/secret.md')).toThrow(/outside the project/);
    expect(() => resolveInside(base, '/etc/passwd')).toThrow(/outside the project/);
    symlinkSync(join(root, 'outside'), join(base, 'link'));
    expect(() => resolveInside(base, 'link/secret.md')).toThrow(/outside the project/);
  });
});

describe('firstHeading', () => {
  it('strips inline markup and roles', () => {
    expect(firstHeading('# The `widget` {term}`API <api>` and [docs](x.md)\n')).toBe('The widget API and docs');
    expect(firstHeading('No heading here\n')).toBeNull();
  });
});
