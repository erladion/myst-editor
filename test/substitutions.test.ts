// MyST's substitutions: {{ name }}, what conf.py's myst_substitutions (or the page's
// front matter) set it to, written back as written.
import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { loadDocument, saveDocument } from '../src/core/document.js';
import { readConfPy, type MystConfig } from '../src/core/project-config.js';
import { schema } from '../src/core/schema.js';
import { substitutionShown } from '../src/renderer/src/formats/myst/substitutions.js';

const conf = readConfPy('extensions = ["myst_parser"]\nmyst_enable_extensions = ["substitution"]\nmyst_substitutions = {\n    "product": "Widget",\n    \'version\': "2.0",\n}\n');

describe('substitutions', () => {
  it('are read from conf.py', () => {
    expect(conf.substitutions).toEqual({ product: 'Widget', version: '2.0' });
    expect(conf.extensions).toContain('substitution');
  });

  it('are what {{ name }} is, written back as written; typing beside one, its line only', () => {
    const text = 'Use {{ product }} {{version}}.\n\nNot in `{{ code }}`.\n';
    const { doc, map } = loadDocument(text, conf);
    const roles = (doc.firstChild!.content.toJSON() as { type: string; attrs?: { name: string; value: string } }[]).filter((n) => n.type === 'role');
    expect(roles.map((r) => [r.attrs!.name, r.attrs!.value])).toEqual([['substitution', ' product '], ['substitution', 'version']]);
    expect(saveDocument(doc, map, conf).text).toBe(text);
    const state = EditorState.create({ doc, schema });
    const saved = saveDocument(state.tr.insertText('Then ', 1).doc, map, conf);
    expect(saved.text).toBe(text.replace('Use', 'Then Use'));
  });

  it('without the extension: text', () => {
    const plain: MystConfig = { ...conf, extensions: [] };
    expect(loadDocument('{{ product }}\n', plain).doc.firstChild!.firstChild!.isText).toBe(true);
  });

  it('show what they stand for: the page’s front matter first, then conf.py', () => {
    const { doc } = loadDocument('---\nmyst:\n  substitutions:\n    product: Gadget\n---\n\n{{ product }} {{ version }} {{ nope }}\n', conf);
    expect(substitutionShown(' product ', conf, doc)).toMatchObject({ text: 'Gadget' });
    expect(substitutionShown('version', conf, doc)).toMatchObject({ text: '2.0' });
    expect(substitutionShown('nope', conf, doc)).toMatchObject({ missing: true });
  });
});
