import { describe, expect, it } from 'vitest';
import { conflictCount, parseConflicts, resolveConflicts } from '../src/core/conflicts.js';

const file = `# Title

<<<<<<< HEAD
Server line one.
Server line two.
=======
My line.
>>>>>>> 1234abc (My commit)

Middle.

<<<<<<< HEAD
||||||| base
Old.
=======
Added by me.
>>>>>>> 1234abc (My commit)
`;

describe('conflicts', () => {
  it('reads conflict markers into spots, dropping a diff3 ancestor section', () => {
    const parsed = parseConflicts(file)!;
    expect(conflictCount(parsed)).toBe(2);
    expect(parsed.parts.filter((p) => p.kind === 'conflict')).toEqual([
      { kind: 'conflict', top: ['Server line one.', 'Server line two.'], bottom: ['My line.'] },
      { kind: 'conflict', top: [], bottom: ['Added by me.'] },
    ]);
  });

  it('writes the file back as chosen, keeping its line endings', () => {
    const parsed = parseConflicts(file)!;
    expect(resolveConflicts(parsed, ['bottom', 'both'])).toBe('# Title\n\nMy line.\n\nMiddle.\n\nAdded by me.\n');
    expect(resolveConflicts(parsed, ['top', 'top'])).toBe('# Title\n\nServer line one.\nServer line two.\n\nMiddle.\n\n');
    const crlf = parseConflicts(file.replace(/\n/g, '\r\n'))!;
    expect(resolveConflicts(crlf, ['both', 'bottom'])).toBe('# Title\r\n\r\nServer line one.\r\nServer line two.\r\nMy line.\r\n\r\nMiddle.\r\n\r\nAdded by me.\r\n');
  });

  it('leaves files without (or with broken) markers alone', () => {
    expect(parseConflicts('# Fine\n')).toBeNull();
    expect(parseConflicts('<<<<<<< HEAD\nunclosed\n')).toBeNull();
  });
});
