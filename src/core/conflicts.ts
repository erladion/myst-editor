// Reading a file git left with conflict markers, and writing it back as the writer
// chose, spot by spot:
//
//   <<<<<<< (top)
//   …
//   ||||||| (the common ancestor, with merge.conflictStyle=diff3; dropped)
//   …
//   =======
//   …
//   >>>>>>> (bottom)
//
// Which side is whose depends on the operation (in a rebase, the top is the server's
// side and the bottom is the writer's own commit), so this only says top and bottom.

export type ConflictPart = { kind: 'same'; lines: string[] } | { kind: 'conflict'; top: string[]; bottom: string[] };

export type Choice = 'top' | 'bottom' | 'both';

export interface ParsedConflicts {
  parts: ConflictPart[];
  eol: '\n' | '\r\n';
  finalNewline: boolean;
}

export function parseConflicts(text: string): ParsedConflicts | null {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const finalNewline = /\r?\n$/.test(text);
  const lines = text.replace(/\r?\n$/, '').split(/\r?\n/);
  const parts: ConflictPart[] = [];
  let same: string[] = [];
  let i = 0;
  let found = false;
  while (i < lines.length) {
    if (!lines[i].startsWith('<<<<<<<')) {
      same.push(lines[i++]);
      continue;
    }
    // A conflict: top until ||||||| or =======, then bottom until >>>>>>>.
    const top: string[] = [];
    const bottom: string[] = [];
    let j = i + 1;
    while (j < lines.length && !lines[j].startsWith('|||||||') && !lines[j].startsWith('=======')) top.push(lines[j++]);
    if (j < lines.length && lines[j].startsWith('|||||||')) while (j < lines.length && !lines[j].startsWith('=======')) j++;
    if (j >= lines.length) return null; // markers that don't close: not ours to guess at
    j++;
    while (j < lines.length && !lines[j].startsWith('>>>>>>>')) bottom.push(lines[j++]);
    if (j >= lines.length) return null;
    if (same.length) parts.push({ kind: 'same', lines: same });
    same = [];
    parts.push({ kind: 'conflict', top, bottom });
    found = true;
    i = j + 1;
  }
  if (same.length) parts.push({ kind: 'same', lines: same });
  return found ? { parts, eol, finalNewline } : null;
}

// The file with each conflict replaced as chosen ("both": the top, then the bottom).
export function resolveConflicts(parsed: ParsedConflicts, choices: Choice[]): string {
  let n = 0;
  const lines: string[] = [];
  for (const part of parsed.parts) {
    if (part.kind === 'same') lines.push(...part.lines);
    else {
      const choice = choices[n++];
      if (choice === 'top' || choice === 'both') lines.push(...part.top);
      if (choice === 'bottom' || choice === 'both') lines.push(...part.bottom);
    }
  }
  return lines.join(parsed.eol) + (parsed.finalNewline ? parsed.eol : '');
}

export const conflictCount = (parsed: ParsedConflicts) => parsed.parts.filter((p) => p.kind === 'conflict').length;
