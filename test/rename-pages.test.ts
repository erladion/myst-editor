// Renaming a page updates every reference to it, and a moved page's own paths.
import { describe, expect, it } from 'vitest';
import { Workspace } from '../src/renderer/src/workspace.js';
import { renameReferences, retitle } from '../src/renderer/src/pages.js';
import type { MystApi, ProjectInfo, SphinxProject } from '../src/shared/api.js';
import { DEFAULT_CONFIG } from '../src/core/project-config.js';

function setup(files: Record<string, string>) {
  const api = {
    readFile: async (p: string) => {
      if (!(p in files)) throw new Error(`no ${p}`);
      return files[p];
    },
    writeFile: async (p: string, text: string) => void (files[p] = text),
    setUnsaved: () => {},
  } as unknown as MystApi;
  const project: SphinxProject = { id: 'p', name: 'Docs', dir: 'docs', sourceDir: '/x/docs', confPy: 'docs/conf.py', config: DEFAULT_CONFIG };
  const info: ProjectInfo = { root: '/x', name: 'x', projects: [project], defaultConfig: DEFAULT_CONFIG, files: Object.keys(files).sort(), titles: {}, buildInputs: '' };
  return { ws: new Workspace(api, info), project, files };
}

describe('renameReferences', () => {
  it('updates tables of contents, {doc} links and links to the file, and the moved page’s paths', async () => {
    const { ws, project, files } = setup({
      'docs/index.md': '# Home\n\n```{toctree}\n:maxdepth: 2\n\nguide/install\nSetting up <guide/configure>\n```\n\nRead {doc}`guide/install` or {doc}`the steps <guide/install>`, and [the page](guide/install.md#pip).\n',
      'docs/guide/configure.md': '# Configure\n\nAfter {doc}`install`, see [installing](install.md). Unrelated: {doc}`/index`.\n',
      // The page being moved (already at its new path, as after the file was renamed).
      'docs/setup/installing.md': '# Installing\n\n![Diagram](../guide/images/x.png)\n\nAlso ![](images/y.png) and {doc}`configure`.\n\n:::{figure} images/z.png\nCaption.\n:::\n',
      'docs/other.md': '# Other\n\nNothing about it.\n',
    });
    // Its references were written for docs/guide/: rewrite them as from there.
    files['docs/setup/installing.md'] = files['docs/setup/installing.md'].replace('../guide/images/x.png', 'images/x.png');
    ws.project = { ...ws.project, files: Object.keys(files).sort() };
    expect(await renameReferences(ws, project, 'docs/guide/install.md', 'docs/setup/installing.md')).toEqual([]);

    expect(files['docs/index.md']).toBe(
      '# Home\n\n```{toctree}\n:maxdepth: 2\n\nsetup/installing\nSetting up <guide/configure>\n```\n\nRead {doc}`setup/installing` or {doc}`the steps <setup/installing>`, and [the page](setup/installing.md#pip).\n',
    );
    expect(files['docs/guide/configure.md']).toBe('# Configure\n\nAfter {doc}`../setup/installing`, see [installing](../setup/installing.md). Unrelated: {doc}`/index`.\n');
    expect(files['docs/setup/installing.md']).toBe(
      '# Installing\n\n![Diagram](../guide/images/x.png)\n\nAlso ![](../guide/images/y.png) and {doc}`../guide/configure`.\n\n:::{figure} ../guide/images/z.png\nCaption.\n:::\n',
    );
    expect(files['docs/other.md']).toBe('# Other\n\nNothing about it.\n');
  });

  it('changes a page’s title', async () => {
    const { ws, files } = setup({ 'docs/a.md': '# Old title\n\nText.\n' });
    await ws.edit('docs/a.md', (state) => retitle(state, 'New title'));
    expect(files['docs/a.md']).toBe('# New title\n\nText.\n');
  });
});
