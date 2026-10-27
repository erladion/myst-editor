// The command line's PDF export, for CI (options: cli-args.ts): the project built by
// its Sphinx and printed as File → Export PDF does, without a window. Progress goes
// to stdout, warnings and errors to stderr; exits with 0 for a PDF, 1 when it failed
// (or warned, with --fail-on-warning), 2 for a mistake in the options.
import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { SphinxProject } from '../shared/api.js';
import { fromProject } from '../shared/projects.js';
import type { CliOptions } from './cli-args.js';
import { openProject } from './project.js';
import { makePdf, pdfName } from './pdf/export.js';
import { loadSettings } from './settings.js';
import { SphinxManager } from './sphinx/manager.js';
import { managerPaths } from './sphinx/service.js';

const say = (text: string) => process.stdout.write(`${text}\n`);
const warn = (text: string) => process.stderr.write(`${text}\n`);
const plain = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error: /, '');

export async function runCli(opts: CliOptions): Promise<number> {
  const folder = resolve(opts.folder);
  let p;
  try {
    p = await openProject(folder);
  } catch {
    warn(`mysteditor: there’s no folder at ${folder}`);
    return 2;
  }
  const chosen = chooseProject(p.projects, p.root, opts.project);
  if (typeof chosen === 'string') {
    warn(`mysteditor: ${chosen}`);
    return 2;
  }
  const project = chosen;
  say(`Making a PDF of ${project.name} (${project.confPy})`);

  // Problems in the settings files, as the app shows them.
  const problems = project.config.editor.problems;
  for (const problem of problems) warn(`${problem.file}: warning: ${problem.message}`);

  const settings = await loadSettings();
  const userEnv = settings.sphinxEnv?.[p.root] ?? {};
  let step = '';
  const manager = new SphinxManager(project, {
    root: p.root,
    searchDirs: p.projects.map((x) => x.sourceDir),
    ...managerPaths(),
    trusted: true,
    buildInputs: () => p.buildInputs,
    extraEnv: () => ({ ...project.config.editor.sphinxEnv, ...userEnv }),
    environment: opts.python ? { kind: 'existing', python: resolve(opts.python) } : (settings.environments?.[p.root] ?? null),
    emit: (state) => {
      if (state.status.kind === 'setting-up' && state.status.step !== step) say(`${(step = state.status.step)}…`);
    },
  });
  try {
    await manager.prepare();
    const { pdf, pages, warnings } = await makePdf(p.root, project, manager, new AbortController().signal, say);
    for (const w of warnings) warn(`${w.source ? `${fromProject(project, w.source)}${w.line ? `:${w.line}` : ''}: ` : ''}${w.level}: ${w.message}`);
    const output = resolve(opts.output ?? `${pdfName(project)}.pdf`);
    await fs.mkdir(dirname(output), { recursive: true });
    await fs.writeFile(output, pdf);
    say(`Saved ${pages} page${pages === 1 ? '' : 's'} as ${output}`);
    const count = warnings.length + problems.length;
    if (opts.failOnWarning && count) {
      warn(`mysteditor: ${count} warning${count === 1 ? '' : 's'} (--fail-on-warning)`);
      return 1;
    }
    return 0;
  } catch (e) {
    warn(`mysteditor: ${plain(e)}`);
    return 1;
  } finally {
    manager.dispose();
  }
}

// The project to export: the one --project names; else the folder's own; else the
// only one. Otherwise what's wrong.
function chooseProject(projects: SphinxProject[], root: string, wanted: string | null): SphinxProject | string {
  if (!projects.length) return `there’s no Sphinx project (conf.py with a root page) in ${root}`;
  const list = projects.map((x) => `  ${x.dir || '.'}  (${x.name})`).join('\n');
  if (wanted !== null) {
    const dir = relative(root, isAbsolute(wanted) ? wanted : resolve(root, wanted)).split(sep).join('/');
    return projects.find((x) => x.dir === dir) ?? `there’s no Sphinx project at ${wanted}. The folder has:\n${list}`;
  }
  return projects.find((x) => x.dir === '') ?? (projects.length === 1 ? projects[0] : `the folder has several Sphinx projects: say which with --project.\n${list}`);
}
