// The keyboard shortcuts, as Help → Keyboard Shortcuts lists them (and the toolbar's
// tooltips and the Insert menu show them). The keys themselves are in editor/setup.ts
// (editing), app/keys.ts (those that open a dialog) and the main process's menu.
export const SHORTCUTS: { group: string; keys: [string, string][] }[] = [
  {
    group: 'Text',
    keys: [
      ['Bold', 'Ctrl+B'],
      ['Italic', 'Ctrl+I'],
      ['Code', 'Ctrl+E'],
      ['Strikethrough', 'Ctrl+Shift+X'],
      ['Link', 'Ctrl+K'],
    ],
  },
  {
    group: 'Paragraphs',
    keys: [
      ['Normal text', 'Ctrl+Shift+N, Ctrl+Alt+0'],
      ['Title', 'Ctrl+Alt+1'],
      ['Heading', 'Ctrl+Alt+2'],
      ['Subheading', 'Ctrl+Alt+3'],
      ['Small heading', 'Ctrl+Alt+4'],
      ['Bulleted list', 'Ctrl+Shift+L, Ctrl+Shift+8'],
      ['Numbered list', 'Ctrl+Shift+7'],
      ['Indent, outdent a list item', 'Tab, Shift+Tab'],
      ['Line break', 'Shift+Enter'],
    ],
  },
  {
    group: 'Insert',
    keys: [
      ['Callout (note)', 'Ctrl+Alt+N'],
      ['Cross-reference', 'Ctrl+Shift+K'],
      ['Figure', 'Ctrl+Shift+G'],
      ['Table', 'Ctrl+Shift+T'],
      ['Code block', 'Ctrl+Shift+E'],
    ],
  },
  {
    group: 'Pages',
    keys: [
      ['Command palette: any command by name', 'Ctrl+Shift+P'],
      ['Go to a page', 'Ctrl+P'],
      ['New page', 'Ctrl+N'],
      ['Save', 'Ctrl+S'],
      ['Find and replace in the page', 'Ctrl+F'],
      ['Search all pages', 'Ctrl+Shift+F'],
      ['Outline of the page', 'Ctrl+Shift+O'],
      ['Markdown view', 'Ctrl+/'],
      ['Switch branch', 'Ctrl+Shift+B'],
      ['Undo, redo', 'Ctrl+Z, Ctrl+Shift+Z'],
    ],
  },
];

const ALL = new Map(SHORTCUTS.flatMap((g) => g.keys));
// The keys for a name in the list above ("Bold" → "Ctrl+B"): the first, where there
// are two.
export const keysFor = (name: string) => (ALL.get(name) ?? '').split(', ')[0];
