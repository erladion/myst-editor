// Lossless splitting of a fenced MyST directive into header / body / closing fence.
//
// We parse this ourselves rather than trusting the mdast: myst-parser only splits out
// options for directives it has a spec for, and leaves them in the body otherwise.

export interface DirectiveSource {
  fence: string; // "```", "::::", ...
  name: string;
  args: string;
  options: [string, string][];
  header: string; // opening line + options (+ one blank separator line), no trailing newline
  body: string | null; // null when there are no body lines at all
  closing: string; // closing fence line, '' if the directive is unterminated
}

const OPEN = /^(\s*)(`{3,}|~{3,}|:{3,})\{([^}\s]+)\}[ \t]*(.*)$/;
const OPTION = /^:([\w.-]+):(?:[ \t]+(.*))?$/;

export function splitDirective(text: string): DirectiveSource | null {
  const lines = text.split('\n');
  const open = OPEN.exec(lines[0]);
  if (!open) return null;
  const [, indent, fence, name, args] = open;

  const isClose = (line: string) => {
    const m = /^\s*(`{3,}|~{3,}|:{3,})\s*$/.exec(line);
    return !!m && m[1][0] === fence[0] && m[1].length >= fence.length;
  };
  let end = lines.length;
  let closing = '';
  if (lines.length > 1 && isClose(lines[lines.length - 1])) {
    end = lines.length - 1;
    closing = lines[end];
  }

  let i = 1;
  const options: [string, string][] = [];
  if (i < end && lines[i].trim() === '---') {
    // YAML options block
    let j = i + 1;
    while (j < end && lines[j].trim() !== '---') j++;
    if (j < end) {
      for (const line of lines.slice(i + 1, j)) {
        const m = /^([\w.-]+):\s*(.*)$/.exec(line.trim());
        if (m) options.push([m[1], unquote(m[2])]);
      }
      i = j + 1;
    }
  } else {
    while (i < end) {
      const m = OPTION.exec(lines[i].trim());
      if (!m) break;
      options.push([m[1], (m[2] ?? '').trim()]);
      i++;
    }
  }
  if (i < end && lines[i].trim() === '') i++;

  return {
    fence: indent + fence,
    name,
    args: args.trim(),
    options,
    header: lines.slice(0, i).join('\n'),
    body: i < end ? lines.slice(i, end).join('\n') : null,
    closing,
  };
}

export function headerKey(name: string, args: string, options: [string, string][], fence: string): string {
  return JSON.stringify([name, args, options, fence]);
}

export function renderHeader(fence: string, name: string, args: string, options: [string, string][]): string {
  const lines = [`${fence}{${name}}${args ? ' ' + args : ''}`];
  for (const [k, v] of options) lines.push(v === '' ? `:${k}:` : `:${k}: ${v}`);
  if (options.length) lines.push('');
  return lines.join('\n');
}

// Make the fence long enough that nothing inside the body can close it. Only a bare
// fence line indented by at most three spaces can close one.
export function fenceFor(fence: string, body: string): string {
  const ch = fence.trim()[0];
  let need = fence.trim().length;
  for (const line of body.split('\n')) {
    const m = /^ {0,3}(`{3,}|~{3,}|:{3,})\s*$/.exec(line);
    if (m && m[1][0] === ch) need = Math.max(need, m[1].length + 1);
  }
  const indent = fence.slice(0, fence.length - fence.trim().length);
  return indent + ch.repeat(need);
}

function unquote(s: string): string {
  const m = /^(["'])(.*)\1$/.exec(s.trim());
  return m ? m[2] : s.trim();
}
