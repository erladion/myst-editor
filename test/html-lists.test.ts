// HTML lists in a Markdown table's cells: made from the list buttons, a new item on
// Enter, items joined on Backspace; written back as HTML in the cell.
import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { loadDocument, saveDocument } from '../src/core/document.js';
import { DEFAULT_CONFIG } from '../src/core/project-config.js';
import { schema } from '../src/core/schema.js';
import { tablePlugins } from '../src/renderer/src/editor/tables.js';
import { joinHtmlItems, splitHtmlItem } from '../src/renderer/src/editor/html.js';
import { toggleList } from '../src/renderer/src/editor/commands.js';

const TABLE = '| Option | Values |\n| --- | --- |\n| mode | <ul><li>fast</li><li>safe</li></ul> |\n| size | big<br>small |\n';

function run(text: string, after: string, ...commands: Command[]): string {
  const { doc, map } = loadDocument(text, DEFAULT_CONFIG);
  let at = -1;
  doc.descendants((n, p) => {
    if (at < 0 && n.isText && n.text!.includes(after)) at = p + n.text!.indexOf(after) + after.length;
    return at < 0;
  });
  let state = EditorState.create({ doc, schema, plugins: tablePlugins('line') });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
  for (const cmd of commands) expect(cmd(state, (tr) => (state = state.apply(tr)))).toBe(true);
  const saved = saveDocument(state.doc, map, DEFAULT_CONFIG);
  expect(saved.problem).toBeUndefined();
  return saved.text;
}

const typing = (text: string): Command => (state, dispatch) => {
  dispatch?.(state.tr.insertText(text));
  return true;
};

describe('an HTML list in a cell', () => {
  it('gets a new item on Enter, the text after the cursor in it', () => {
    expect(run(TABLE, 'fa', splitHtmlItem)).toBe(TABLE.replace('<li>fast</li>', '<li>fa</li><li>st</li>'));
    expect(run(TABLE, 'safe', splitHtmlItem, typing('quick'))).toBe(TABLE.replace('<li>safe</li>', '<li>safe</li><li>quick</li>'));
  });

  it('joins an item to the one before on Backspace at its start', () => {
    expect(run(TABLE, 'fast', splitHtmlItem, joinHtmlItems)).toBe(TABLE);
  });

  it('is made from the cell’s lines by the list button, and taken back by it', () => {
    expect(run(TABLE, 'big', toggleList(schema.nodes.bullet_list))).toBe(TABLE.replace('big<br>small', '<ul><li>big</li><li>small</li></ul>'));
    expect(run(TABLE, 'fast', toggleList(schema.nodes.ordered_list))).toBe(TABLE.replace('<ul><li>fast</li><li>safe</li></ul>', 'fast<br>safe'));
  });

  it('outside one, Enter does what it did', () => {
    const { doc } = loadDocument(TABLE, DEFAULT_CONFIG);
    const state = EditorState.create({ doc, schema, plugins: tablePlugins('line') });
    expect(splitHtmlItem(state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3))))).toBe(false);
  });
});
