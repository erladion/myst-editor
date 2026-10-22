import { describe, expect, it } from 'vitest';
import { loadDocument } from '../src/core/document.js';
import { columnOffset, locateAlerts } from '../src/core/vale.js';
import type { ValeAlert } from '../src/shared/vale.js';
import { DEFAULT_CONFIG } from '../src/core/project-config.js';

const alert = (Line: number, start: number, Match: string): ValeAlert => ({
  Line,
  Span: [start, start + Array.from(Match).length - 1],
  Check: 'Vale.Spelling',
  Message: `Did you really mean '${Match}'?`,
  Severity: 'error',
  Match,
  Link: '',
  Action: { Name: '', Params: null },
  Suggestions: [],
});

// The text each located alert covers in the document.
function covered(src: string, alerts: ValeAlert[]) {
  const { doc } = loadDocument(src);
  return locateAlerts(doc, src, DEFAULT_CONFIG, alerts).map(({ from, to }) => doc.textBetween(from, to));
}

describe('locateAlerts', () => {
  it('finds a word in a paragraph, past formatting before it', () => {
    const src = '# Title\n\nWe **really** utilize it.\n';
    expect(covered(src, [alert(3, 15, 'utilize')])).toEqual(['utilize']);
  });

  it('picks the same occurrence as in the file', () => {
    const src = 'Use the the tool, and the {ref}`x` the end.\n';
    const { doc } = loadDocument(src);
    const [second] = locateAlerts(doc, src, DEFAULT_CONFIG, [alert(1, 23, 'the')]);
    // The third "the" in the line (the second is in "the the").
    expect(second.from).toBe(1 + src.indexOf('the', 9));
  });

  it('finds words in a callout and in a list', () => {
    const src = ':::{note}\nPlease utilize the note.\n:::\n\n- one\n- tow\n';
    expect(covered(src, [alert(2, 8, 'utilize'), alert(6, 3, 'tow')])).toEqual(['utilize', 'tow']);
  });

  it('skips what it can’t find; code-like blocks are searched as they are', () => {
    const src = 'Plain text.\n\n```{raw} html\n<b>widgte</b>\n```\n';
    expect(covered(src, [alert(1, 1, 'Nothing'), alert(4, 4, 'widgte')])).toEqual(['widgte']);
  });
});

it('columns count characters, not UTF-16 units', () => {
  expect(columnOffset('😀 sure', 3)).toBe(3);
});
