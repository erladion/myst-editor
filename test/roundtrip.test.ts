import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Node as PMNode } from 'prosemirror-model';
import { parseMyst } from '../src/core/myst/parse.js';
import { serializeMyst } from '../src/core/myst/serialize.js';
import { normalized } from './helpers.js';

const corpusDir = join(import.meta.dirname, '..', 'corpus');
const corpus = readdirSync(corpusDir)
  .filter((f) => f.endsWith('.md'))
  .map((f) => [f, readFileSync(join(corpusDir, f), 'utf8')] as const);

describe.each(corpus)('%s', (_name, src) => {
  it('round-trips byte-for-byte when unedited', () => {
    const { doc, map } = parseMyst(src);
    expect(serializeMyst(doc, map)).toBe(src);
  });

  it('round-trips after the document is rebuilt from JSON (no shared node identity)', () => {
    const { doc, map } = parseMyst(src);
    const copy = PMNode.fromJSON(doc.type.schema, doc.toJSON());
    expect(serializeMyst(copy, map)).toBe(src);
  });

  it('fresh serialization re-parses to the same document', () => {
    const { doc } = parseMyst(src);
    const fresh = serializeMyst(doc, parseMyst(src).map, { fresh: true });
    const reparsed = parseMyst(fresh).doc;
    expect(normalized(reparsed)).toEqual(normalized(doc));
  });

  it('produces a valid document', () => {
    expect(() => parseMyst(src).doc.check()).not.toThrow();
  });
});
