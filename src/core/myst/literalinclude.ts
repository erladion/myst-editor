// What a {literalinclude} shows of its file: its options applied as Sphinx applies them
// (pyobject, start-…, end-…, lines, dedent, prepend, append, in that order).

export interface Included {
  lines: string[];
  first: number; // the file's line number of the first line shown (1-based)
  problem: string | null; // what Sphinx would warn about, if anything
}

// "1,3,5-10,20-": the line numbers it names (1-based), in order.
function lineSpec(spec: string, count: number): number[] | null {
  const out: number[] = [];
  for (const part of spec.split(',').map((p) => p.trim()).filter(Boolean)) {
    const m = /^(\d*)\s*(-)?\s*(\d*)$/.exec(part);
    if (!m || (!m[1] && !m[3])) return null;
    const from = m[1] ? Number(m[1]) : 1;
    const to = m[2] ? (m[3] ? Number(m[3]) : count) : from;
    for (let n = from; n <= Math.min(to, count); n++) out.push(n);
  }
  return out;
}

// A Python class or function by its (dotted) name: its lines, decorators included.
function pyobject(lines: string[], name: string): [number, number] | null {
  let from = 0;
  let to = lines.length;
  let indent = -1;
  for (const part of name.split('.')) {
    const def = new RegExp(`^(\\s*)(?:async\\s+)?(?:def|class)\\s+${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    let found = -1;
    for (let i = from; i < to; i++) {
      const m = def.exec(lines[i]);
      if (m && m[1].length > indent) {
        found = i;
        indent = m[1].length;
        break;
      }
    }
    if (found < 0) return null;
    let end = found + 1;
    while (end < to && (!lines[end].trim() || /^\s*/.exec(lines[end])![0].length > indent)) end++;
    while (end > found + 1 && !lines[end - 1].trim()) end--;
    let start = found;
    while (start > from && /^\s*@/.test(lines[start - 1])) start--;
    from = start;
    to = end;
  }
  return [from, to];
}

export function literalInclude(text: string, options: [string, string][]): Included {
  const opt = (k: string) => options.find(([o]) => o === k)?.[1];
  let lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  let numbers = lines.map((_, i) => i + 1);
  let problem: string | null = null;
  const keep = (from: number, to: number) => {
    lines = lines.slice(from, to);
    numbers = numbers.slice(from, to);
  };

  const obj = opt('pyobject');
  if (obj) {
    const at = pyobject(lines, obj);
    if (at) keep(...at);
    else problem = `No object ${obj} in the file`;
  }
  const after = opt('start-after');
  const at = opt('start-at');
  if (after || at) {
    const i = lines.findIndex((l) => l.includes((after ?? at)!));
    if (i < 0) problem = `“${after ?? at}” isn’t in the file`;
    else keep(after ? i + 1 : i, lines.length);
  }
  const before = opt('end-before');
  const endAt = opt('end-at');
  if (before || endAt) {
    const i = lines.findIndex((l) => l.includes((before ?? endAt)!));
    if (i < 0) problem = `“${before ?? endAt}” isn’t in the file`;
    else keep(0, before ? i : i + 1);
  }
  const spec = opt('lines');
  if (spec) {
    const wanted = lineSpec(spec, lines.length);
    if (!wanted) problem = `Lines “${spec}” can’t be read`;
    else {
      numbers = wanted.map((n) => numbers[n - 1]);
      lines = wanted.map((n) => lines[n - 1]);
      if (!lines.length) problem = `No lines ${spec} in the file`;
    }
  }
  const dedent = opt('dedent');
  if (dedent !== undefined) {
    const by = dedent.trim() ? Number(dedent) : Math.min(...lines.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0].length));
    if (Number.isFinite(by)) lines = lines.map((l) => (l.slice(0, by).trim() ? l.trimStart() : l.slice(by)));
  }
  const prepend = opt('prepend');
  const append = opt('append');
  return { lines: [...(prepend !== undefined ? [prepend] : []), ...lines, ...(append !== undefined ? [append] : [])], first: numbers[0] ?? 1, problem };
}
