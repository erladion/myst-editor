// File → New Project: a folder with a Sphinx project in it, ready to write in and to
// build: docs/ with conf.py, a first page and its requirements; a README; and, if
// asked, a git repository with it all as the first commit.
import { ipcMain } from 'electron';
import { existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { NewProject, NewProjectResult } from '../shared/api.js';
import { git } from './git/service.js';

// A Python string (JSON's are, for what a title holds).
const py = (s: string) => JSON.stringify(s);

export function projectFiles(title: string): Record<string, string> {
  return {
    'README.md': `# ${title}\n\nDocumentation written in MyST Markdown and built with Sphinx.\n\n    pip install -r docs/requirements.txt\n    sphinx-build docs _build/html\n`,
    '.gitignore': '_build/\n.venv/\n__pycache__/\n',
    'docs/conf.py': `# Sphinx's settings: https://www.sphinx-doc.org/en/master/usage/configuration.html

project = ${py(title)}

extensions = ["myst_parser"]
myst_enable_extensions = ["colon_fence", "deflist", "tasklist"]

html_theme = "furo"
exclude_patterns = ["_build"]
`,
    'docs/requirements.txt': 'sphinx>=7\nmyst-parser>=3\nfuro\n',
    'docs/index.md': `# ${title}\n\nWhat this documentation is about, and who it's for.\n\n\`\`\`{toctree}\n:maxdepth: 2\n\ngetting-started\n\`\`\`\n`,
    'docs/getting-started.md':
      '# Getting started\n\nThe first steps.\n\n:::{tip}\nAdd pages with **New page** in the sidebar (Ctrl+N). They go into the table of contents of the page you choose.\n:::\n',
  };
}

export function registerNewProjectIpc() {
  ipcMain.handle('create-project', async (_e, p: NewProject): Promise<NewProjectResult> => {
    const title = String(p.title).trim();
    const folder = String(p.folder).trim();
    if (!title) return { ok: false, message: 'Give the project a title.' };
    if (!folder || /[\\/]|^\.+$/.test(folder)) return { ok: false, message: 'The folder’s name can’t have / or \\ in it.' };
    const dir = join(String(p.parent), folder);
    if (existsSync(dir) && (await fs.readdir(dir)).length) return { ok: false, message: `There’s a folder called ${folder} there already, with files in it.` };
    try {
      for (const [rel, text] of Object.entries(projectFiles(title))) {
        await fs.mkdir(join(dir, rel, '..'), { recursive: true });
        await fs.writeFile(join(dir, rel), text, { flag: 'wx' });
      }
    } catch (e) {
      return { ok: false, message: `Couldn’t make the project: ${e instanceof Error ? e.message : e}` };
    }
    let note: string | null = null;
    if (p.git) {
      try {
        await git.initWithEverything(dir, `New documentation: ${title}`);
      } catch (e) {
        const text = e instanceof Error ? `${e.message}\n${(e as { output?: string }).output ?? ''}` : String(e);
        note = /tell me who you are|user\.(name|email)/i.test(text)
          ? 'The project is made, and is a git repository, but nothing is committed yet: git doesn’t know your name and email. Set them (git config --global user.name "…" and user.email "…"), then commit from the status bar.'
          : `The project is made, but git couldn’t start a repository in it: ${text.split('\n')[0]}`;
      }
    }
    return { ok: true, path: dir, note };
  });
}
