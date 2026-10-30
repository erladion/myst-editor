// What a {literalinclude} shows of its file.
import { describe, expect, it } from 'vitest';
import { literalInclude } from '../src/core/myst/literalinclude.js';

const FILE = ['import os', '', '@cached', 'def hello(name):', '    """Say hello."""', '    print(name)', '', '', 'class Greeter:', '    def greet(self):', '        return 1', '', '    def part(self):', '        return 2', '', '# end'].join('\n') + '\n';
const shown = (options: [string, string][]) => literalInclude(FILE, options);

describe('a literalinclude', () => {
  it('shows the whole file without options', () => {
    expect(shown([]).lines).toEqual(FILE.trimEnd().split('\n'));
  });

  it('takes lines, ranges and open ranges', () => {
    expect(shown([['lines', '1,4-5']])).toMatchObject({ lines: ['import os', 'def hello(name):', '    """Say hello."""'], first: 1 });
    expect(shown([['lines', '15-']]).lines).toEqual(['', '# end']);
  });

  it('starts and ends at text', () => {
    expect(shown([['start-after', 'class Greeter'], ['end-before', 'def part']]).lines).toEqual(['    def greet(self):', '        return 1', '']);
    expect(shown([['start-at', 'def hello'], ['end-at', 'print']])).toMatchObject({ lines: ['def hello(name):', '    """Say hello."""', '    print(name)'], first: 4 });
    expect(shown([['start-after', 'nowhere']]).problem).toMatch(/nowhere/);
  });

  it('finds a Python object, decorators and all, by a dotted name', () => {
    expect(shown([['pyobject', 'hello']]).lines).toEqual(['@cached', 'def hello(name):', '    """Say hello."""', '    print(name)']);
    expect(shown([['pyobject', 'Greeter.part'], ['dedent', '']])).toMatchObject({ lines: ['def part(self):', '    return 2'], first: 13 });
    expect(shown([['pyobject', 'Missing']]).problem).toMatch(/Missing/);
  });

  it('dedents by a number, and prepends and appends', () => {
    expect(shown([['lines', '5-6'], ['dedent', '4'], ['prepend', '# start'], ['append', '# done']]).lines).toEqual(['# start', '"""Say hello."""', 'print(name)', '# done']);
  });
});
