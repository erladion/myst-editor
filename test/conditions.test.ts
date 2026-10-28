import { describe, expect, it } from 'vitest';
import { describe as text, evaluate, parseCondition, readMarker, unknownNames, withExpression } from '../src/core/conditions.js';
import { capabilityNames, loadEditorConfig, type ConditionsDef } from '../src/core/editor-config.js';
import { conditionColor } from '../src/renderer/src/editor/conditions.js';

const has = (...names: string[]) => (n: string) => names.includes(n);
const parse = (s: string) => {
  const r = parseCondition(s);
  if (!r.ok) throw new Error(r.error);
  return r;
};

describe('parseCondition', () => {
  it('uses not > and > or, with case-insensitive keywords', () => {
    const { expr, names } = parse('A or B AND not C');
    expect(text(expr)).toBe('A or B and not C');
    expect(names).toEqual(['A', 'B', 'C']);
    expect(evaluate(expr, has('B'))).toBe(true);
    expect(evaluate(expr, has('B', 'C'))).toBe(false);
    expect(evaluate(expr, has('A', 'C'))).toBe(true);
  });

  it('supports parentheses', () => {
    const { expr } = parse('(A or B) and not (C or D)');
    expect(text(expr)).toBe('(A or B) and not (C or D)');
    expect(evaluate(expr, has('A'))).toBe(true);
    expect(evaluate(expr, has('A', 'D'))).toBe(false);
  });

  it('explains malformed conditions', () => {
    expect(parseCondition('')).toEqual({ ok: false, error: 'The condition is empty' });
    expect(parseCondition('A or')).toEqual({ ok: false, error: 'The condition ends too early' });
    expect(parseCondition('A B')).toEqual({ ok: false, error: 'Unexpected “B”' });
    expect(parseCondition('(A or B')).toEqual({ ok: false, error: 'A “(” is missing its “)”' });
    expect(parseCondition('A & B')).toEqual({ ok: false, error: 'Unexpected “&”' });
    expect(parseCondition('and A')).toEqual({ ok: false, error: 'Expected a capability name, found “and”' });
  });
});

describe('markers', () => {
  const kw: [string, string] = ['if', 'endif'];
  it('recognises start and end markers, tolerating spacing', () => {
    expect(readMarker('<!-- if: CapabilityX or CapabilityY -->', kw)).toEqual({ kind: 'start', expr: 'CapabilityX or CapabilityY' });
    expect(readMarker('<!--if:X-->', kw)).toEqual({ kind: 'start', expr: 'X' });
    expect(readMarker('<!-- endif -->', kw)).toEqual({ kind: 'end' });
    expect(readMarker('<!-- if-inline: X -->', kw)).toBeNull();
    expect(readMarker('<!-- a comment -->', kw)).toBeNull();
    expect(readMarker('<!-- if-inline: X -->', ['if-inline', 'endif-inline'])).toEqual({ kind: 'start', expr: 'X' });
  });

  it('replaces the expression and keeps the marker’s own spacing', () => {
    expect(withExpression('<!--  if:   A  -->', 'B or C')).toBe('<!--  if:   B or C  -->');
  });
});

describe('unknownNames', () => {
  const conditions = (caseSensitive: boolean): ConditionsDef => ({
    block: ['if', 'endif'],
    inline: ['if-inline', 'endif-inline'],
    caseSensitive,
    capabilities: ['CapabilityX', 'CapabilityY'],
    capabilitiesFile: 'c.json', capabilitiesPath: null, capabilitiesKey: null,
    colors: {},
  });
  it('flags names the capabilities file does not list', () => {
    expect(unknownNames(['CapabilityX', 'Typo', 'capabilityy'], conditions(true))).toEqual(['Typo', 'capabilityy']);
    expect(unknownNames(['CapabilityX', 'Typo', 'capabilityy'], conditions(false))).toEqual(['Typo']);
  });
});

describe('capabilityNames', () => {
  it('accepts the common shapes', () => {
    expect(capabilityNames(['A', 'B'], null)).toEqual(['A', 'B']);
    expect(capabilityNames({ capabilities: ['A'] }, null)).toEqual(['A']);
    expect(capabilityNames({ A: true, B: false }, null)).toEqual(['A', 'B']);
    expect(capabilityNames([{ name: 'A' }, { id: 'B' }], null)).toEqual(['A', 'B']);
    expect(capabilityNames({ product: { features: ['A'] } }, 'product.features')).toEqual(['A']);
    expect(capabilityNames(42, null)).toBeNull();
  });
});

describe('loadEditorConfig', () => {
  const source = (file: string, text: string, files: Record<string, string> = {}) => ({
    file,
    text,
    readCapabilities: (p: string) => {
      if (!(p in files)) throw new Error('file not found');
      return files[p];
    },
  });

  it('reads directives, roles and conditions', () => {
    const config = loadEditorConfig([
      source(
        '.mysteditor.toml',
        `[directives.company-callout]\nlabel = "Internal note"\ntone = "warning"\n[directives.company-callout.options.audience]\nchoices = ["internal", "public"]\n\n[roles.jira]\nlabel = "Jira"\nurl = "https://jira.example.com/browse/{value}"\n\n[conditions]\ncapabilities = "caps.json"\n`,
        { 'caps.json': '{"capabilities": ["X", "Y"]}' },
      ),
    ]);
    expect(config.problems).toEqual([]);
    expect(config.directives['company-callout']).toEqual({
      label: 'Internal note',
      tone: 'warning',
      body: 'markdown',
      options: { audience: { choices: ['internal', 'public'] } },
      insert: true,
    });
    expect(config.roles.jira).toEqual({ label: 'Jira', url: 'https://jira.example.com/browse/{value}' });
    expect(config.conditions).toMatchObject({ block: ['if', 'endif'], inline: ['if-inline', 'endif-inline'], capabilities: ['X', 'Y'] });
  });

  it('merges files outermost first', () => {
    const config = loadEditorConfig([
      source('.mysteditor.toml', '[directives.a]\nlabel = "Root A"\n[directives.b]\nlabel = "Root B"\n[conditions]\nblock = ["when", "endwhen"]\n'),
      source('guide/.mysteditor.toml', '[directives.a]\nlabel = "Guide A"\n[conditions]\ncase_sensitive = false\n'),
    ]);
    expect(config.directives.a.label).toBe('Guide A');
    expect(config.directives.b.label).toBe('Root B');
    expect(config.conditions).toMatchObject({ block: ['when', 'endwhen'], caseSensitive: false });
  });

  it('reports mistakes with the file they are in, and keeps what is valid', () => {
    const config = loadEditorConfig([
      source('.mysteditor.toml', '[directives.a]\ntone = "loud"\nbody = "html"\n[directives.b]\nlabel = "B"\n[roles.x]\nurl = "javascript:alert(1)"\n[conditions]\ncapabilities = "missing.json"\nblock = ["if"]\n[extras]\n'),
      source('guide/.mysteditor.toml', 'this is not toml'),
    ]);
    expect(config.problems.map((p) => `${p.file}: ${p.message}`)).toEqual([
      '.mysteditor.toml: Unknown section [extras] (expected directives, roles, tables, conditions, sphinx, asciidoctor or pdf)',
      '.mysteditor.toml: [directives.a] body must be "markdown", "text" or "none"',
      '.mysteditor.toml: [roles.x] url must start with http:// or https://',
      '.mysteditor.toml: [conditions] block must be two keywords, like ["if","endif"]',
      '.mysteditor.toml: Couldn’t read missing.json: file not found',
      expect.stringMatching(/^guide\/\.mysteditor\.toml: Not valid TOML/),
    ]);
    expect(Object.keys(config.directives)).toEqual(['b']);
  });
});

describe('condition colours', () => {
  const settings = (colors: Record<string, string> = {}, caseSensitive = true): ConditionsDef => ({
    block: ['if', 'endif'],
    inline: ['if-inline', 'endif-inline'],
    caseSensitive,
    capabilities: ['CapabilityX', 'CapabilityY', 'CapabilityZ'],
    capabilitiesFile: 'c.json', capabilitiesPath: null, capabilitiesKey: null,
    colors,
  });

  it('gives each capability its own colour, the same everywhere', () => {
    const s = settings();
    expect([conditionColor('CapabilityX', s), conditionColor('CapabilityY', s), conditionColor('CapabilityZ', s)]).toEqual([
      'var(--cond-purple)',
      'var(--cond-orange)',
      'var(--cond-teal)',
    ]);
    expect(conditionColor(' CapabilityX  or CapabilityY', s)).toBe(conditionColor('CapabilityX or CapabilityY', s));
    expect(conditionColor('CapabilityX or CapabilityY', s)).toMatch(/^var\(--cond-\w+\)$/);
  });

  it('uses colours chosen in the settings', () => {
    expect(conditionColor('CapabilityX', settings({ CapabilityX: 'orange' }))).toBe('var(--cond-orange)');
    expect(conditionColor('capabilityx or capabilityy', settings({ 'CapabilityX or CapabilityY': '#0a7f6f' }, false))).toBe('#0a7f6f');
  });

  it('reads [conditions.colors], refusing what isn’t a colour', () => {
    const config = loadEditorConfig([
      { file: '.mysteditor.toml', readCapabilities: () => '[]', text: '[conditions]\n[conditions.colors]\nCapabilityX = "teal"\n"X or Y" = "#abc"\nBad = "url(x)"\n' },
    ]);
    expect(config.conditions?.colors).toEqual({ CapabilityX: 'teal', 'X or Y': '#abc' });
    expect(config.problems.map((p) => p.message)).toEqual([expect.stringMatching(/^\[conditions\.colors\] "Bad": use one of purple, orange/)]);
  });
});

describe('[sphinx.env]', () => {
  const load = (...texts: string[]) => loadEditorConfig(texts.map((text, i) => ({ file: i ? 'guide/.mysteditor.toml' : '.mysteditor.toml', readCapabilities: () => '[]', text })));

  it('reads environment variables for builds, inner files winning', () => {
    const config = load('[sphinx.env]\nPRODUCT = "enterprise"\nYEAR = 2026\nDRAFT = true\n', '[sphinx.env]\nPRODUCT = "community"\n');
    expect(config.sphinxEnv).toEqual({ PRODUCT: 'community', YEAR: '2026', DRAFT: 'true' });
    expect(config.problems).toEqual([]);
  });

  it('refuses names a process environment can’t hold', () => {
    const config = load('[sphinx.env]\n"1BAD" = "x"\n"WITH SPACE" = "x"\nLIST = ["a"]\nOK = "y"\n[sphinx]\nother = 1\n');
    expect(config.sphinxEnv).toEqual({ OK: 'y' });
    expect(config.problems.map((p) => p.message)).toEqual([
      '[sphinx] unknown setting "other"',
      '[sphinx.env] "1BAD" isn’t a valid variable name',
      '[sphinx.env] "WITH SPACE" isn’t a valid variable name',
      '[sphinx.env] LIST must be text, a number or true/false',
    ]);
  });
});
