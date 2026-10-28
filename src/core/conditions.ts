// Conditional-content expressions and markers.
//
//   <!-- if: CapabilityX or (CapabilityY and not CapabilityZ) -->
//   ...
//   <!-- endif -->
//
// Precedence: not > and > or. Keywords are case-insensitive; capability names follow
// the project's case_sensitive setting.
import type { ConditionsDef } from './editor-config.js';
import { ifdefMarkers } from './asciidoc/conditions.js';

export type Expr =
  | { kind: 'name'; name: string }
  | { kind: 'not'; expr: Expr }
  | { kind: 'and' | 'or'; left: Expr; right: Expr };

export type ParseResult = { ok: true; expr: Expr; names: string[] } | { ok: false; error: string };

type Token = { kind: 'name' | 'and' | 'or' | 'not' | '(' | ')'; text: string; at: number };

function tokenize(input: string): Token[] | string {
  const tokens: Token[] = [];
  const re = /\s*(?:(\()|(\))|([A-Za-z_][\w.:-]*)|(\S))/y;
  let m: RegExpExecArray | null;
  while (re.lastIndex < input.length && (m = re.exec(input))) {
    if (m[4]) return `Unexpected “${m[4]}”`;
    const at = m.index + m[0].length - (m[1] ?? m[2] ?? m[3]).length;
    if (m[1]) tokens.push({ kind: '(', text: '(', at });
    else if (m[2]) tokens.push({ kind: ')', text: ')', at });
    else {
      const word = m[3].toLowerCase();
      const kind = word === 'and' || word === 'or' || word === 'not' ? word : 'name';
      tokens.push({ kind, text: m[3], at });
    }
  }
  return tokens;
}

export function parseCondition(input: string): ParseResult {
  const tokens = tokenize(input);
  if (typeof tokens === 'string') return { ok: false, error: tokens };
  if (!tokens.length) return { ok: false, error: 'The condition is empty' };
  let i = 0;
  const names: string[] = [];
  const peek = () => tokens[i];
  const fail = (msg: string): never => {
    throw new Error(msg);
  };
  const or = (): Expr => {
    let left = and();
    while (peek()?.kind === 'or') {
      i++;
      left = { kind: 'or', left, right: and() };
    }
    return left;
  };
  const and = (): Expr => {
    let left = not();
    while (peek()?.kind === 'and') {
      i++;
      left = { kind: 'and', left, right: not() };
    }
    return left;
  };
  const not = (): Expr => {
    if (peek()?.kind === 'not') {
      i++;
      return { kind: 'not', expr: not() };
    }
    return atom();
  };
  const atom = (): Expr => {
    const t = tokens[i++];
    if (!t) return fail('The condition ends too early');
    if (t.kind === 'name') {
      names.push(t.text);
      return { kind: 'name', name: t.text };
    }
    if (t.kind === '(') {
      const inner = or();
      if (tokens[i++]?.kind !== ')') fail('A “(” is missing its “)”');
      return inner;
    }
    return fail(`Expected a capability name, found “${t.text}”`);
  };
  try {
    const expr = or();
    if (i < tokens.length) fail(`Unexpected “${tokens[i].text}”`);
    return { ok: true, expr, names };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export function evaluate(expr: Expr, has: (name: string) => boolean): boolean {
  switch (expr.kind) {
    case 'name':
      return has(expr.name);
    case 'not':
      return !evaluate(expr.expr, has);
    case 'and':
      return evaluate(expr.left, has) && evaluate(expr.right, has);
    case 'or':
      return evaluate(expr.left, has) || evaluate(expr.right, has);
  }
}

// Names in a condition that the capabilities file doesn't list.
export function unknownNames(names: string[], conditions: ConditionsDef): string[] {
  if (!conditions.capabilities.length) return [];
  const known = new Set(conditions.caseSensitive ? conditions.capabilities : conditions.capabilities.map((c) => c.toLowerCase()));
  return names.filter((n) => !known.has(conditions.caseSensitive ? n : n.toLowerCase()));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export type Marker = { kind: 'start'; expr: string } | { kind: 'end' };

// Recognise `<!-- keyword: expr -->` / `<!-- endkeyword -->` (whitespace-tolerant).
export function readMarker(source: string, keywords: [string, string]): Marker | null {
  const text = source.trim();
  const start = new RegExp(`^<!--\\s*${escapeRe(keywords[0])}\\s*:\\s*([\\s\\S]*?)\\s*-->$`, 'i').exec(text);
  if (start) return { kind: 'start', expr: start[1] };
  if (new RegExp(`^<!--\\s*${escapeRe(keywords[1])}\\s*-->$`, 'i').test(text)) return { kind: 'end' };
  return null;
}

// How a page writes conditions' markers, for block conditions and inline ones (null:
// its format has none).
export interface MarkerSyntax {
  read(source: string): Marker | null;
  start(expr: string): string;
  end(): string;
  // An existing start marker with another expression, written as it was otherwise.
  withExpression(source: string, expr: string): string;
}

export interface ConditionMarkers {
  block: MarkerSyntax;
  inline: MarkerSyntax | null;
  // Why a condition can't be written with these markers; null if it can.
  refuse(expr: Expr): string | null;
}

// HTML comments with the project's keywords: `<!-- if: X -->` … `<!-- endif -->`.
export function commentMarkers(settings: ConditionsDef): ConditionMarkers {
  const syntax = (keywords: [string, string]): MarkerSyntax => ({
    read: (source) => readMarker(source, keywords),
    start: (expr) => startMarker(keywords[0], expr),
    end: () => endMarker(keywords[1]),
    withExpression,
  });
  return { block: syntax(settings.block), inline: syntax(settings.inline), refuse: () => null };
}

const SYNTAXES: Record<NonNullable<ConditionsDef['markers']>, (settings: ConditionsDef) => ConditionMarkers> = { comments: commentMarkers, ifdef: ifdefMarkers };
const made = new WeakMap<ConditionsDef, ConditionMarkers>();

// The markers the settings say pages write.
export function markersOf(settings: ConditionsDef): ConditionMarkers {
  let markers = made.get(settings);
  if (!markers) made.set(settings, (markers = SYNTAXES[settings.markers ?? 'comments'](settings)));
  return markers;
}

// A condition parsed, and refused if the markers can't write it.
export function parseFor(settings: ConditionsDef, input: string): ParseResult {
  const parsed = parseCondition(input);
  const refused = parsed.ok ? markersOf(settings).refuse(parsed.expr) : null;
  return refused ? { ok: false, error: refused } : parsed;
}

export function startMarker(keyword: string, expr: string): string {
  return `<!-- ${keyword}: ${expr.trim()} -->`;
}

export function endMarker(keyword: string): string {
  return `<!-- ${keyword} -->`;
}

// Replace the expression in an existing start marker, keeping its spacing and case.
export function withExpression(source: string, expr: string): string {
  return source.replace(/(:\s*)[\s\S]*?(\s*-->\s*)$/, (_m, lead: string, tail: string) => `${lead}${expr.trim()}${tail}`);
}

// A readable form: "CapabilityX or CapabilityY and not Z" with grouping kept.
export function describe(expr: Expr, parent: Expr['kind'] | null = null): string {
  switch (expr.kind) {
    case 'name':
      return expr.name;
    case 'not':
      return `not ${describe(expr.expr, 'not')}`;
    default: {
      const text = `${describe(expr.left, expr.kind)} ${expr.kind} ${describe(expr.right, expr.kind)}`;
      const needsParens = parent === 'not' || (parent === 'and' && expr.kind === 'or');
      return needsParens ? `(${text})` : text;
    }
  }
}
