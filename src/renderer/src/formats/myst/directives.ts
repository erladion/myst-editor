// How MyST's directives and roles are presented to writers.
import type { EditorConfig } from '../../../../core/editor-config';
import type { DirectiveInfo } from '../../editor/tones';

export const ADMONITIONS: Record<string, DirectiveInfo> = {
  note: { label: 'Note', tone: 'note' },
  hint: { label: 'Hint', tone: 'tip' },
  tip: { label: 'Tip', tone: 'tip' },
  important: { label: 'Important', tone: 'info' },
  seealso: { label: 'See also', tone: 'neutral' },
  attention: { label: 'Attention', tone: 'warning' },
  caution: { label: 'Caution', tone: 'warning' },
  warning: { label: 'Warning', tone: 'warning' },
  danger: { label: 'Danger', tone: 'danger' },
  error: { label: 'Error', tone: 'danger' },
  admonition: { label: 'Callout', tone: 'neutral', argLabel: 'Title' },
};

const OTHER: Record<string, DirectiveInfo> = {
  versionadded: { label: 'New in version', tone: 'tip', argLabel: 'Version' },
  versionchanged: { label: 'Changed in version', tone: 'info', argLabel: 'Version' },
  deprecated: { label: 'Deprecated since version', tone: 'warning', argLabel: 'Version' },
  versionremoved: { label: 'Removed in version', tone: 'danger', argLabel: 'Version' },
  figure: { label: 'Figure', tone: 'neutral', argLabel: 'Image' },
  image: { label: 'Image', tone: 'neutral', argLabel: 'Image' },
  rubric: { label: 'Rubric', tone: 'neutral', argLabel: 'Text' },
  toggle: { label: 'Toggle', tone: 'neutral' },
  exercise: { label: 'Exercise', tone: 'info', argLabel: 'Title' },
  solution: { label: 'Solution', tone: 'tip', argLabel: 'Exercise' },
  'exercise-start': { label: 'Exercise', tone: 'info', argLabel: 'Title' },
  'exercise-end': { label: 'End of the exercise', tone: 'info' },
  'solution-start': { label: 'Solution', tone: 'tip', argLabel: 'Exercise' },
  'solution-end': { label: 'End of the solution', tone: 'tip' },
  'button-ref': { label: 'Button', tone: 'neutral', argLabel: 'Page or label' },
  'button-link': { label: 'Button', tone: 'neutral', argLabel: 'URL' },
  table: { label: 'Table', tone: 'neutral', argLabel: 'Caption' },
  dropdown: { label: 'Dropdown', tone: 'neutral', argLabel: 'Title' },
  topic: { label: 'Topic', tone: 'neutral', argLabel: 'Title' },
  sidebar: { label: 'Sidebar', tone: 'neutral', argLabel: 'Title' },
  margin: { label: 'Margin note', tone: 'neutral', argLabel: 'Title' },
  epigraph: { label: 'Epigraph', tone: 'neutral' },
  'pull-quote': { label: 'Pull quote', tone: 'neutral' },
  highlights: { label: 'Highlights', tone: 'neutral' },
  'tab-set': { label: 'Tabs', tone: 'neutral' },
  'tab-item': { label: 'Tab', tone: 'neutral', argLabel: 'Tab title' },
  grid: { label: 'Grid', tone: 'neutral', argLabel: 'Columns' },
  'grid-item': { label: 'Grid item', tone: 'neutral' },
  'grid-item-card': { label: 'Card', tone: 'neutral', argLabel: 'Title' },
  card: { label: 'Card', tone: 'neutral', argLabel: 'Title' },
  div: { label: 'Section', tone: 'neutral', argLabel: 'Classes' },
  container: { label: 'Container', tone: 'neutral', argLabel: 'Classes' },
};

// How to present a directive: the project's own settings first, then the built-ins.
export function directiveInfo(name: string, editor?: EditorConfig): DirectiveInfo {
  const declared = editor?.directives[name];
  if (declared) return { label: declared.label ?? name, tone: declared.tone ?? 'neutral', argLabel: declared.argument };
  return ADMONITIONS[name] ?? OTHER[name] ?? { label: name, tone: 'neutral', argLabel: 'Argument' };
}

// Callouts offered in the Insert menu and the type switcher, in display order.
export const CALLOUT_CHOICES = ['note', 'tip', 'hint', 'important', 'seealso', 'attention', 'caution', 'warning', 'danger', 'error', 'admonition'];

// Roles that point somewhere, and how to describe them.
export const REFERENCE_ROLES: Record<string, string> = {
  ref: 'Section',
  doc: 'Page',
  numref: 'Numbered reference',
  term: 'Glossary term',
  eq: 'Equation',
  any: 'Reference',
  download: 'Download',
  cite: 'Citation',
  'cite:p': 'Citation',
  'cite:t': 'Citation',
};

// `title <target>` → { title, target }
export function splitRoleValue(value: string): { title: string | null; target: string } {
  const m = /^([\s\S]*?)\s*<([^<>]+)>$/.exec(value);
  return m && m[1] ? { title: m[1], target: m[2] } : { title: null, target: value.replace(/^~/, '') };
}
