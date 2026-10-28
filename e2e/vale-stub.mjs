// A stand-in for Vale in the tests (see src/main/vale.ts): flags two words as Vale
// would, and like Vale needs a .vale.ini in the folder or above it, and skips the
// words in its vocabulary's accept.txt.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
if (args[0] === 'fix') {
  const alert = JSON.parse(args[1]);
  process.stdout.write(JSON.stringify({ suggestions: alert.Action.Name === 'suggest' ? ['widget', 'widgets'] : [], error: '' }));
  process.exit(0);
}
let dir = process.cwd();
while (!existsSync(join(dir, '.vale.ini'))) {
  if (dirname(dir) === dir) {
    process.stderr.write(JSON.stringify({ Code: 'E100', Text: 'E100 [.vale.ini not found] Runtime error\n\nno config file found' }));
    process.exit(2);
  }
  dir = dirname(dir);
}
const ini = join(dir, '.vale.ini');
const setting = (name) => new RegExp(`^${name}\\s*=\\s*(.+)$`, 'm').exec(readFileSync(ini, 'utf8').split(/^\[/m)[0])?.[1].trim();
const styles = join(dir, setting('StylesPath') ?? 'styles');
const vocab = setting('Vocab');
if (args[0] === 'ls-config') {
  process.stdout.write(JSON.stringify({ Vocab: vocab ? [vocab] : [], RootINI: ini, Paths: ['/nowhere/vale/styles', styles] }));
  process.exit(0);
}
const accepted = vocab && existsSync(join(styles, 'config', 'vocabularies', vocab, 'accept.txt'))
  ? readFileSync(join(styles, 'config', 'vocabularies', vocab, 'accept.txt'), 'utf8').split(/\r?\n/).filter(Boolean).map((e) => new RegExp(`^(?:${e})$`))
  : [];
const RULES = [
  { re: /\butilize\b/gi, Check: 'House.Utilize', Message: "Use 'use' instead of 'utilize'.", Severity: 'warning', Action: { Name: 'replace', Params: ['use'] } },
  { re: /\bwidgte\b/g, Check: 'Vale.Spelling', Message: "Did you really mean 'widgte'?", Severity: 'error', Action: { Name: 'suggest', Params: ['spellings'] } },
];
const file = args[args.length - 1];
// AsciiDoc: like Vale, through the asciidoctor command on the PATH (not there: Vale's error).
let converted = null;
if (file.endsWith('.adoc')) {
  const run = spawnSync('asciidoctor', ['-s', '-a', 'notitle!', '-a', 'attribute-missing=drop', '--safe-mode', 'secure', '-'], { input: readFileSync(file, 'utf8'), encoding: 'utf8', shell: process.platform === 'win32' });
  if (run.error || run.status !== 0) {
    process.stderr.write(JSON.stringify({ Code: 'E100', Text: `E100 [lintADoc] Runtime error\n\nasciidoctor not found: ${run.error?.message ?? run.stderr}` }));
    process.exit(2);
  }
  converted = run.stdout;
}
const alerts = [];
readFileSync(file, 'utf8')
  .split('\n')
  .forEach((line, i) => {
    for (const r of RULES) {
      for (const m of line.matchAll(r.re)) {
        if (accepted.some((a) => a.test(m[0]))) continue;
        // (Only what's in the converted page: not in comments, say.)
        if (converted !== null && !converted.includes(m[0])) continue;
        const start = Array.from(line.slice(0, m.index)).length + 1;
        const { re: _, ...rule } = r;
        alerts.push({ ...rule, Span: [start, start + Array.from(m[0]).length - 1], Description: '', Link: '', Match: m[0], Line: i + 1 });
      }
    }
  });
process.stdout.write(JSON.stringify(alerts.length ? { [file]: alerts } : {}));
