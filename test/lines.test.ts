import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDocument } from '../src/core/document.js';
import { blockPathAtLine, positionOfPath } from '../src/core/lines.js';

const fixture = readFileSync(join(import.meta.dirname, '..', 'e2e', 'fixture', 'docs', 'index.md'), 'utf8');

function blockAt(src: string, line: number) {
  const { doc, map } = loadDocument(src);
  const path = blockPathAtLine(doc, map, line);
  return path && positionOfPath(doc, path)!.node;
}

describe('blockPathAtLine', () => {
  it('finds the block Sphinx reports a warning on', () => {
    // mysteditor_build.py reports the unknown {company-callout} at line 47.
    expect(blockAt(fixture, 47)?.attrs.name).toBe('company-callout');
  });

  it('finds the innermost block inside directives and list items', () => {
    const src = '# T\n\n:::{note}\n:class: x\n\nInside **the** note.\n:::\n\n- one\n- two\n  continued\n';
    expect(blockAt(src, 6)?.textContent).toBe('Inside the note.');
    expect(blockAt(src, 3)?.type.name).toBe('md_directive');
    expect(blockAt(src, 11)?.textContent).toBe('two continued');
    expect(blockAt(src, 2)).toBeNull();
  });
});

describe('positionOfPath', () => {
  it('stops at the deepest part of the path that still exists', () => {
    const { doc } = loadDocument('# T\n\nPara\n');
    expect(positionOfPath(doc, [1])).toEqual({ pos: 3, node: doc.child(1) });
    expect(positionOfPath(doc, [1, 0, 5])?.node).toBe(doc.child(1));
    expect(positionOfPath(doc, [7])).toBeNull();
  });
});
