import { describe, expect, it } from 'vitest';
import { diffDocs } from '../src/core/changes.js';
import { loadDocument } from '../src/core/document.js';

// The changes, with the text they cover in the page now (or what was removed).
function changes(before: string, after: string) {
  const now = loadDocument(after).doc;
  return diffDocs(loadDocument(before).doc, now).map((c) =>
    c.kind === 'removed-block' || c.kind === 'removed-text' ? [c.kind, c.text] : [c.kind, now.textBetween(c.from, c.to, '|')],
  );
}

describe('diffDocs', () => {
  it('finds nothing when nothing changed', () => {
    expect(changes('# T\n\nA paragraph.\n', '# T\n\nA paragraph.\n')).toEqual([]);
  });

  it('finds words added and removed in a paragraph', () => {
    expect(changes('# T\n\nThe quick fox jumps.\n', '# T\n\nThe quick brown fox leaps.\n')).toEqual([
      ['added-text', 'brown '],
      ['removed-text', 'jumps'],
      ['added-text', 'leaps'],
    ]);
  });

  it('finds blocks added and removed, and where', () => {
    expect(changes('# T\n\nOne.\n\nTwo.\n\nThree.\n', '# T\n\nOne.\n\n## New\n\nThree.\n\nFour.\n')).toEqual([
      ['removed-block', 'Two.'],
      ['added-block', 'New'],
      ['added-block', 'Four.'],
    ]);
  });

  it('looks inside lists and callouts, and finds formatting changed', () => {
    expect(changes('- a\n- b\n\n:::{note}\nKeep this.\n:::\n\nPlain words.\n', '- a\n- b\n- c\n\n:::{note}\nKeep that.\n:::\n\nPlain **words**.\n')).toEqual([
      ['added-block', 'c'],
      ['removed-text', 'this'],
      ['added-text', 'that'],
      ['changed-block', 'Plain words.'],
    ]);
  });

  it('treats a callout of another kind as removed and added', () => {
    expect(changes(':::{note}\nText.\n:::\n', ':::{warning}\nText.\n:::\n').map(([k]) => k)).toEqual(['removed-block', 'added-block']);
  });
});
