// A stand-in for Vale in the tests (see src/main/vale.ts): flags two words as Vale
// would, and like Vale needs a .vale.ini in the folder or above it.
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
const RULES = [
  { re: /\butilize\b/gi, Check: 'House.Utilize', Message: "Use 'use' instead of 'utilize'.", Severity: 'warning', Action: { Name: 'replace', Params: ['use'] } },
  { re: /\bwidgte\b/g, Check: 'Vale.Spelling', Message: "Did you really mean 'widgte'?", Severity: 'error', Action: { Name: 'suggest', Params: ['spellings'] } },
];
const file = args[args.length - 1];
const alerts = [];
readFileSync(file, 'utf8')
  .split('\n')
  .forEach((line, i) => {
    for (const r of RULES) {
      for (const m of line.matchAll(r.re)) {
        const start = Array.from(line.slice(0, m.index)).length + 1;
        const { re: _, ...rule } = r;
        alerts.push({ ...rule, Span: [start, start + Array.from(m[0]).length - 1], Description: '', Link: '', Match: m[0], Line: i + 1 });
      }
    }
  });
process.stdout.write(JSON.stringify(alerts.length ? { [file]: alerts } : {}));
