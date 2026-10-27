import { describe, expect, it } from 'vitest';
import { parseCliArgs } from '../src/main/cli-args.js';

describe('the command line’s PDF export options', () => {
  const parse = (...args: string[]) => parseCliArgs(['electron', 'out/main/index.js', ...args]);

  it('is only for --export-pdf: otherwise the app starts as usual', () => {
    expect(parse()).toBeNull();
    expect(parse('/home/me/docs')).toBeNull();
  });

  it('reads the options, as --name value or --name=value, among Chromium’s', () => {
    expect(parse('--ozone-platform=headless', '--no-sandbox', '--export-pdf', 'docs', '--project=user-guide', '--output', 'out/manual.pdf', '--python', '.venv/bin/python', '--fail-on-warning')).toEqual({
      folder: 'docs',
      project: 'user-guide',
      output: 'out/manual.pdf',
      python: '.venv/bin/python',
      failOnWarning: true,
    });
    expect(parse('--export-pdf=docs')).toEqual({ folder: 'docs', project: null, output: null, python: null, failOnWarning: false });
  });

  it('says what’s wrong', () => {
    expect(parse('--export-pdf')).toEqual({ error: '--export-pdf needs a value' });
    expect(parse('--export-pdf', '--output', 'a.pdf')).toEqual({ error: '--export-pdf needs a value' });
    expect(parse('--export-pdf', 'docs', '--ouput', 'a.pdf')).toEqual({ error: 'unknown option --ouput' });
    expect(parse('--export-pdf', 'docs', '--output', 'a.pdf', '--output', 'b.pdf')).toEqual({ error: '--output is given twice' });
    expect(parse('--export-pdf', 'docs', '--help')).toEqual({ help: true });
    expect(parse('--export-pdf', '--help')).toEqual({ help: true });
  });
});
