// The command line's PDF export (see cli.ts): which options it was given.
//
//   wysie --export-pdf <folder> [--project <dir>] [--output <file>]
//              [--python <path>] [--fail-on-warning]

import { PRODUCT } from '../shared/product.js';

export interface CliOptions {
  folder: string; // the project's folder, or one with projects under it
  project: string | null; // which of them, relative to the folder
  output: string | null; // the PDF; default: the project's name, in the current folder
  python: string | null; // for Sphinx: a Python with it installed; default: as the app sets one up
  failOnWarning: boolean;
}

export const USAGE = `Usage: ${PRODUCT.command} --export-pdf <folder> [options]

Makes a PDF of a project, as File → Export PDF does, without a window: a Sphinx
project, or an Asciidoctor one (AsciiDoc pages, built from their main document).
<folder> is the project's (with its ${PRODUCT.settingsFile}), or a folder with projects
under it, with --project to say which.

Options:
  --project <dir>     the project's folder (with conf.py, antora.yml or its main .adoc), relative to <folder>
  --output <file>     where the PDF goes (default: the project's name, here)
  --python <path>     for Sphinx: a Python with Sphinx and MyST-Parser installed (default:
                      an environment set up from the project's requirements, as the app does)
  --fail-on-warning   exit with 1 when the build or the settings warn about anything
  --help              show this

On Linux without a display, start it with --ozone-platform=headless first, or under xvfb-run.`;

const VALUED = ['--export-pdf', '--project', '--output', '--python'] as const;
// Chromium's and Electron's own switches that take no value; others are written
// --name=value, and left to them.
const CHROMIUM_FLAGS = new Set(['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--headless', '--enable-logging', '--no-zygote']);

// The export's options, if the app was started for one (null: started as usual), or
// what's wrong with them. Anything that isn't an option is ignored (in development,
// the app's own script comes first).
export function parseCliArgs(argv: string[]): CliOptions | { error: string } | { help: true } | null {
  if (!argv.some((a) => a === '--export-pdf' || a.startsWith('--export-pdf='))) return null;
  if (argv.includes('--help')) return { help: true };
  const values: Partial<Record<(typeof VALUED)[number], string>> = {};
  let failOnWarning = false;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const [name, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, null];
    const valued = VALUED.find((v) => v === name);
    if (valued) {
      const value = inline ?? argv[++i];
      if (value === undefined || (inline === null && value.startsWith('--'))) return { error: `${name} needs a value` };
      if (values[valued] !== undefined) return { error: `${name} is given twice` };
      values[valued] = value;
    } else if (name === '--fail-on-warning') failOnWarning = true;
    else if (inline === null && !CHROMIUM_FLAGS.has(name)) return { error: `unknown option ${name}` };
  }
  return {
    folder: values['--export-pdf']!,
    project: values['--project'] ?? null,
    output: values['--output'] ?? null,
    python: values['--python'] ?? null,
    failOnWarning,
  };
}
