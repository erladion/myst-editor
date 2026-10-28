import { describe, expect, it } from 'vitest';
import { mergeWarnings, type BuildResult } from '../src/shared/sphinx.js';
import type { BuildWarning } from '../src/shared/build.js';

const docs = {
  index: { source: 'index.md', title: 'Home', uri: 'index.html', children: ['a', 'b'] },
  a: { source: 'a.md', title: 'A', uri: 'a.html', children: [] },
  b: { source: 'b.md', title: 'B', uri: 'b.html', children: [] },
};

const w = (source: string | null, phase: BuildWarning['phase'], message = `${phase} in ${source}`): BuildWarning => ({
  source,
  line: 1,
  level: 'warning',
  message,
  type: null,
  phase,
});

const build = (patch: Partial<BuildResult>): BuildResult => ({ ok: true, docs, warnings: [], duration: 0.1, ...patch });

describe('mergeWarnings', () => {
  const previous = [w('index.md', 'read'), w('a.md', 'write'), w('b.md', 'consistency'), w(null, 'setup')];

  it('keeps warnings for documents the build did not touch', () => {
    const merged = mergeWarnings(previous, build({ read_docs: [], written_docs: [], consistency_checked: false }));
    expect(merged.map((x) => x.message)).toEqual(['read in index.md', 'write in a.md', 'consistency in b.md']);
  });

  it('replaces read warnings for re-read documents and write warnings for re-written ones', () => {
    const merged = mergeWarnings(
      previous,
      build({ read_docs: ['index'], written_docs: ['index', 'a'], consistency_checked: false, warnings: [w('a.md', 'write', 'new')] }),
    );
    expect(merged.map((x) => x.message)).toEqual(['consistency in b.md', 'new']);
  });

  it('replaces consistency warnings whenever the check ran', () => {
    const merged = mergeWarnings(previous, build({ read_docs: [], written_docs: [], consistency_checked: true }));
    expect(merged.map((x) => x.phase)).toEqual(['read', 'write']);
  });

  it('drops warnings for deleted documents', () => {
    const { a: _a, ...withoutA } = docs;
    const merged = mergeWarnings(previous, build({ docs: withoutA, read_docs: [], written_docs: [] }));
    expect(merged.map((x) => x.source)).toEqual(['index.md', 'b.md']);
  });
});
