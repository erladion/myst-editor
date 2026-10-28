// A stand-in for the asciidoctor command, for tools that run it on AsciiDoc pages
// (Vale reads .adoc files through it) when it isn't installed: the app's own
// Asciidoctor.js, run by the app's Node (see vale.ts). The usual options: -s, -a,
// -S, -B, -o and the file (or - for standard input); others are taken and left be.
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { convert, getVersion } from '@asciidoctor/core';

async function main(argv: string[]): Promise<number> {
  const attributes: Record<string, string | false> = {};
  let embedded = false;
  let safe = 'secure';
  let out: string | null = null;
  let base: string | undefined;
  let input: string | null = null;
  const value = (i: number, arg: string, long: string) => (arg.includes('=') && arg.startsWith('--') ? [arg.slice(long.length + 1), i] as const : arg.length > 2 && !arg.startsWith('--') ? [arg.slice(2), i] as const : [argv[i + 1] ?? '', i + 1] as const);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-V' || arg === '--version') {
      process.stdout.write(`Asciidoctor ${getVersion()} [https://asciidoctor.org]\n`);
      return 0;
    }
    if (arg === '-s' || arg === '--no-header-footer' || arg === '-e' || arg === '--embedded') embedded = true;
    else if (arg.startsWith('-a') || arg.startsWith('--attribute')) {
      const [a, next] = value(i, arg, '--attribute');
      i = next;
      const m = /^([^=!@]+)(!)?@?(?:=(.*))?$/.exec(a);
      if (m) attributes[m[1]] = m[2] ? false : (m[3] ?? '');
    } else if (arg.startsWith('-S') || arg.startsWith('--safe-mode')) [safe, i] = value(i, arg, '--safe-mode');
    else if (arg.startsWith('-o') || arg.startsWith('--out-file')) [out, i] = value(i, arg, '--out-file');
    else if (arg.startsWith('-B') || arg.startsWith('--base-dir')) [base, i] = value(i, arg, '--base-dir');
    else if (/^-(b|d|r|T|E|D|I|n)$/.test(arg) || /^--(backend|doctype|require|template-dir|template-engine|destination-dir|load-path)$/.test(arg)) i++; // an option with a value, left be
    else if (arg === '-' || !arg.startsWith('-')) input = arg;
  }
  const text = input === null || input === '-' ? await stdin() : await fs.readFile(input, 'utf8');
  // Unset attributes are given as name! (Asciidoctor.js takes false for "unset").
  const attrs = Object.fromEntries(Object.entries(attributes).map(([k, v]) => (v === false ? [`${k}!`, ''] : [k, v])));
  const html = (await convert(text, { safe, standalone: !embedded, base_dir: base ?? (input && input !== '-' ? resolve(input, '..') : process.cwd()), attributes: { ...attrs, linkcss: '' } })) as string;
  if (out && out !== '-') await fs.writeFile(out, html);
  else process.stdout.write(html);
  return 0;
}

function stdin(): Promise<string> {
  return new Promise((done) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (text += d));
    process.stdin.on('end', () => done(text));
  });
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    process.stderr.write(`asciidoctor: ${e instanceof Error ? e.message : e}\n`);
    process.exit(1);
  },
);
