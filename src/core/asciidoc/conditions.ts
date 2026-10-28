// Conditional content in AsciiDoc: Asciidoctor's ifdef/ifndef, with capabilities as
// attributes.
//
//   ifdef::CapabilityX[]          CapabilityX
//   ifdef::X,Y[]                  X or Y
//   ifdef::X+Y[]                  X and Y
//   ifndef::X[]                   not X
//   ifndef::X,Y[]                 not (X or Y)
//   ifndef::X+Y[]                 not (X and Y)
//   endif::[]
//
// Other conditions (X and not Y, say) have no ifdef form, and are refused.
import { describe, parseCondition, type ConditionMarkers, type Expr, type Marker, type MarkerSyntax } from '../conditions.js';

const NAME = /^[A-Za-z_][\w-]*$/;

export const CONDITION_START = /^(ifdef|ifndef)::([\w-]+(?:[,+][\w-]+)*)\[\][ \t]*$/;
export const CONDITION_END = /^endif::[\w,+-]*\[\][ \t]*$/;

// The names an expression joins all with `kind`, or null.
function joined(expr: Expr, kind: 'and' | 'or'): string[] | null {
  if (expr.kind === 'name') return NAME.test(expr.name) ? [expr.name] : null;
  if (expr.kind !== kind) return null;
  const left = joined(expr.left, kind);
  const right = joined(expr.right, kind);
  return left && right ? [...left, ...right] : null;
}

// The ifdef/ifndef line for a condition, or null if it has none.
function directiveFor(expr: Expr): string | null {
  const negated = expr.kind === 'not';
  const inner = negated ? expr.expr : expr;
  const or = joined(inner, 'or');
  const names = or ?? joined(inner, 'and');
  if (!names) return null;
  return `${negated ? 'ifndef' : 'ifdef'}::${names.join(or ? ',' : '+')}[]`;
}

export function readCondition(line: string): Marker | null {
  const text = line.trim();
  if (CONDITION_END.test(text)) return { kind: 'end' };
  const m = CONDITION_START.exec(text);
  if (!m) return null;
  const or = m[2].includes(',');
  const names = m[2].split(/[,+]/);
  const body = names.join(or ? ' or ' : ' and ');
  if (m[1] === 'ifdef') return { kind: 'start', expr: body };
  return { kind: 'start', expr: names.length > 1 ? `not (${body})` : `not ${body}` };
}

const block: MarkerSyntax = {
  read: readCondition,
  start(expr) {
    const parsed = parseCondition(expr);
    const line = parsed.ok ? directiveFor(parsed.expr) : null;
    if (!line) throw new Error(`AsciiDoc can't write the condition “${expr}”`);
    return line;
  },
  end: () => 'endif::[]',
  withExpression: (_source, expr) => block.start(expr),
};

export function ifdefMarkers(): ConditionMarkers {
  return {
    block,
    inline: null,
    refuse: (expr) =>
      directiveFor(expr)
        ? null
        : `AsciiDoc can’t write “${describe(expr)}”: its ifdef conditions are one capability, several joined with or, or several joined with and, each with not in front if needed.`,
  };
}
