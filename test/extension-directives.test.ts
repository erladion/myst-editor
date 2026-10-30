// Directives of common Sphinx extensions, edited as blocks: sphinx-togglebutton's
// toggle, sphinx-exercise's exercises and solutions, sphinx-design's buttons, and the
// rubric; written as they were.
import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { loadDocument, saveDocument } from '../src/core/document.js';
import { DEFAULT_CONFIG, readConfPy } from '../src/core/project-config.js';
import { schema } from '../src/core/schema.js';

const PAGE = [
  '```{rubric} Further reading',
  '```',
  '',
  '```{toggle}',
  'Hidden *text*.',
  '```',
  '',
  ':::{exercise} Add them',
  ':label: ex-add',
  '',
  'What is 1 + 1?',
  ':::',
  '',
  '````{solution} ex-add',
  'Two.',
  '````',
  '',
  '```{solution-start} ex-add',
  '```',
  '',
  'Written between the markers.',
  '',
  '```{solution-end}',
  '```',
  '',
  '```{button-ref} install',
  ':color: primary',
  '',
  'Install it',
  '```',
  '',
].join('\n');

describe('extension directives', () => {
  it('are blocks: their contents edited as the page’s, the markers and the rubric with nothing in them', () => {
    const { doc, map } = loadDocument(PAGE, DEFAULT_CONFIG);
    expect(doc.content.content.map((n) => `${n.type.name}:${n.attrs.name ?? ''}:${n.childCount}`)).toEqual([
      'md_directive:rubric:0',
      'md_directive:toggle:1',
      'md_directive:exercise:1',
      'md_directive:solution:1',
      'md_directive:solution-start:0',
      'paragraph::1',
      'md_directive:solution-end:0',
      'md_directive:button-ref:1',
    ]);
    expect(saveDocument(doc, map, DEFAULT_CONFIG).text).toBe(PAGE);
  });

  it('typed in: their lines only', () => {
    const { doc, map } = loadDocument(PAGE, DEFAULT_CONFIG);
    let at = -1;
    doc.descendants((n, p) => void (at < 0 && n.isText && n.text === 'What is 1 + 1?' && (at = p + n.text.length)));
    expect(saveDocument(EditorState.create({ doc, schema }).tr.insertText(' And 2 + 2?', at).doc, map, DEFAULT_CONFIG).text).toBe(PAGE.replace('What is 1 + 1?', 'What is 1 + 1? And 2 + 2?'));
  });

  it('conf.py says which extensions there are', () => {
    expect(readConfPy('extensions = [\n    "myst_parser",\n    "sphinx_design",\n]\nextensions.append("sphinx_exercise")\n').sphinxExtensions).toEqual(['myst_parser', 'sphinx_design', 'sphinx_exercise']);
  });
});
