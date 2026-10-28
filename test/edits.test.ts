// Simulated writer edits: each must change only the lines it should.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { diffLines } from 'diff';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, type Transaction } from 'prosemirror-state';
import { parseMyst } from '../src/core/myst/parse.js';
import { serializeMyst } from '../src/core/myst/serialize.js';
import { schema } from '../src/core/schema.js';

const read = (name: string) => readFileSync(join(import.meta.dirname, '..', 'corpus', name), 'utf8');

// Apply `edit` to the parsed file and return the resulting line diff as
// { removed, added } line arrays (excluding unchanged lines).
function edit(file: string, fn: (state: EditorState) => Transaction) {
  const src = read(file);
  const { doc, map } = parseMyst(src);
  const state = EditorState.create({ doc, schema });
  const next = state.apply(fn(state)).doc;
  const out = serializeMyst(next, map);
  const removed: string[] = [];
  const added: string[] = [];
  for (const part of diffLines(src, out)) {
    const lines = part.value.replace(/\n$/, '').split('\n');
    if (part.removed) removed.push(...lines);
    if (part.added) added.push(...lines);
  }
  return { out, removed, added, reparsed: parseMyst(out).doc };
}

// Document position right after the first occurrence of `text`.
function after(doc: PMNode, text: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isText) {
      const i = node.text!.indexOf(text);
      if (i >= 0) found = pos + i + text.length;
    }
  });
  if (found < 0) throw new Error(`text not found: ${text}`);
  return found;
}

function findNode(doc: PMNode, pred: (n: PMNode) => boolean): { node: PMNode; pos: number } {
  let hit: { node: PMNode; pos: number } | undefined;
  doc.descendants((node, pos) => {
    if (!hit && pred(node)) hit = { node, pos };
    return !hit;
  });
  if (!hit) throw new Error('node not found');
  return hit;
}

describe('minimal diffs for edits', () => {
  it('typing inside an admonition changes only that line', () => {
    const r = edit('02-directives.md', (s) => s.tr.insertText(' really', after(s.doc, 'Admonitions can')));
    expect(r.removed).toEqual(['Admonitions can have a custom title and *rich* content.']);
    expect(r.added).toEqual(['Admonitions can really have a custom title and *rich* content.']);
  });

  it('editing one line of a wrapped paragraph keeps the other lines and roles intact', () => {
    const r = edit('03-sphinx.md', (s) => s.tr.insertText(' all', after(s.doc, 'for the settings')));
    expect(r.removed).toEqual(['See {ref}`configuration` for the settings, or {doc}`getting-started` for']);
    expect(r.added).toEqual(['See {ref}`configuration` for the settings all, or {doc}`getting-started` for']);
  });

  it('editing a nested list item changes only that item', () => {
    const r = edit('01-basics.md', (s) => s.tr.insertText(' (edited)', after(s.doc, 'Nested item')));
    expect(r.removed).toEqual(['  * Nested item']);
    expect(r.added).toEqual(['  * Nested item (edited)']);
  });

  it('adding an ordered list item continues the numbering and style', () => {
    const r = edit('01-basics.md', (s) => {
      const pos = after(s.doc, 'release notes.');
      // Past the closing paragraph/item tokens and the new item's opening ones.
      return s.tr.split(pos, 2).insertText('Celebrate.', pos + 4);
    });
    expect(r.removed).toEqual([]);
    expect(r.added).toEqual(['4. Celebrate.']);
  });

  it('changing a directive option rewrites only the header', () => {
    const r = edit('02-directives.md', (s) => {
      const { node, pos } = findNode(s.doc, (n) => n.type.name === 'md_directive' && n.attrs.name === 'figure');
      const options = node.attrs.options.map(([k, v]: [string, string]) => [k, k === 'width' ? '50%' : v]);
      return s.tr.setNodeMarkup(pos, null, { ...node.attrs, options });
    });
    expect(r.removed).toEqual([':width: 80%']);
    expect(r.added).toEqual([':width: 50%']);
  });

  it('editing inside nested colon-fence directives keeps all fences', () => {
    const r = edit('04-custom-extensions.md', (s) => s.tr.insertText(' --cask', after(s.doc, 'brew install widget')));
    expect(r.removed).toEqual(['Install with `brew install widget`.']);
    expect(r.added).toEqual(['Install with `brew install widget --cask`.']);
  });

  it('deleting a directive removes it and its separating blank line', () => {
    const r = edit('02-directives.md', (s) => {
      const { node, pos } = findNode(s.doc, (n) => n.attrs.name === 'warning');
      return s.tr.delete(pos, pos + node.nodeSize);
    });
    expect(r.added).toEqual([]);
    expect(r.removed).toEqual([
      ':::{warning}',
      'Changing these values on a running system requires a restart.',
      ':::',
      '',
    ]);
  });

  it('editing a block next to an opaque custom directive leaves the directive untouched', () => {
    const r = edit('04-custom-extensions.md', (s) => s.tr.insertText('!', after(s.doc, 'Hidden content with ')));
    expect(r.removed).toEqual(['Hidden content with **bold** text.']);
    expect(r.added).toEqual(['Hidden content with !**bold** text.']);
    expect(r.out).toContain(':::{company-callout}\n:audience: internal\n:owner: docs-team\n');
  });

  it('typed text that looks like syntax is escaped and survives a re-parse', () => {
    const typed = 'Costs $5 and $6, use *stars*, <b>tags</b> and 1. not-a-list';
    const r = edit('01-basics.md', (s) => {
      const end = s.doc.content.size;
      return s.tr.insert(end, schema.node('paragraph', null, [schema.text(typed)]));
    });
    expect(r.added.join('\n')).toBe('\nCosts \\$5 and \\$6, use \\*stars\\*, \\<b>tags\\</b> and 1. not-a-list');
    const last = r.reparsed.lastChild!;
    expect(last.type.name).toBe('paragraph');
    expect(last.textContent).toBe(typed);
  });

  it('editing a paragraph keeps reference links, underscore style and empty links', () => {
    const r = edit('05-links-and-style.md', (s) => s.tr.insertText('!', after(s.doc, 'like some')));
    expect(r.removed).toEqual(['This page uses _underscore emphasis_ and __underscore strong__, like some']);
    expect(r.added).toEqual(['This page uses _underscore emphasis_ and __underscore strong__, like some!']);

    const r2 = edit('05-links-and-style.md', (s) => s.tr.insertText('!', after(s.doc, 'for details')));
    expect(r2.added).toEqual(['projects do. See the [user guide] and the [API docs][api] for details!.']);

    const r3 = edit('05-links-and-style.md', (s) => s.tr.insertText('!', after(s.doc, "target's title")));
    expect(r3.added).toEqual(["Auto-titled references pick up the target's title!: [](configuration) and"]);

    const r4 = edit('05-links-and-style.md', (s) => s.tr.insertText('!', after(s.doc, 'custom schemes')));
    expect(r4.added).toEqual(['[](#user-guide-refs). Autolinks with custom schemes!: <gh-user:someone> and']);

    const r5 = edit('05-links-and-style.md', (s) => s.tr.insertText('!', after(s.doc, 'with parentheses')));
    expect(r5.added).toEqual(['A link with parentheses!: [Samba](https://en.wikipedia.org/wiki/Samba_(software)).']);
  });

  it('adding to a "1. 1. 1." list keeps the repeated number', () => {
    const r = edit('05-links-and-style.md', (s) => {
      const pos = after(s.doc, 'same number');
      return s.tr.split(pos, 2).insertText('item', pos + 4);
    });
    expect(r.removed).toEqual([]);
    expect(r.added).toEqual(['1. item']);
  });

  it('editing a widely padded list item keeps its padding', () => {
    const r = edit('05-links-and-style.md', (s) => s.tr.insertText('!', after(s.doc, 'on two lines')));
    expect(r.removed).toEqual(['    on two lines']);
    expect(r.added).toEqual(['    on two lines!']);
  });

  it('inserting a new admonition writes a colon-fence directive', () => {
    const r = edit('01-basics.md', (s) => {
      const note = schema.node('md_directive', { name: 'note', fence: ':::' }, [
        schema.node('paragraph', null, [schema.text('Remember to restart.')]),
      ]);
      return s.tr.insert(after(s.doc, 'pip install widget') + 1, note);
    });
    expect(r.removed).toEqual([]);
    expect(r.added).toEqual([':::{note}', 'Remember to restart.', ':::', '']);
    expect(r.reparsed.toString()).toContain('md_directive');
  });
});

describe('Enter in a definition list', async () => {
  const { definitionEnter } = await import('../src/renderer/src/editor/commands.js');
  const { TextSelection } = await import('prosemirror-state');
  const run = (state: EditorState) => {
    let next = state;
    definitionEnter(state, (tr) => (next = state.apply(tr)));
    return next;
  };
  const at = (state: EditorState, type: string, end = true) => {
    let pos = -1;
    state.doc.descendants((n, p) => {
      if (pos < 0 && n.type.name === type) pos = end ? p + n.nodeSize - 1 : p + 1;
    });
    return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
  };

  it('goes from a term to its description, then to a new term', () => {
    const { doc } = parseMyst('API\n: How programs talk.\n');
    // At the end of the term: into the description.
    let state = run(at(EditorState.create({ doc, schema }), 'definition_term'));
    expect(state.selection.$from.parent.textContent).toBe('How programs talk.');
    // A term without one gets one.
    const bare = schema.nodes.doc.create(null, schema.nodes.definition_list.create(null, schema.nodes.definition_item.create(null, schema.nodes.definition_term.create(null, schema.text('SDK')))));
    state = run(at(EditorState.create({ doc: bare, schema }), 'definition_term'));
    expect(state.doc.firstChild!.firstChild!.childCount).toBe(2);
    expect(state.selection.$from.parent.type.name).toBe('paragraph');
    // Enter in the empty description: a new term instead.
    state = run(state);
    expect(state.doc.firstChild!.childCount).toBe(2);
    expect(state.doc.firstChild!.firstChild!.childCount).toBe(1);
    expect(state.selection.$from.parent.type.name).toBe('definition_term');
  });
});
