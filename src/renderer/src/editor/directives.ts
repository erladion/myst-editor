// How directives and roles are presented to writers.

export type Tone = 'note' | 'info' | 'tip' | 'warning' | 'danger' | 'neutral';

interface DirectiveInfo {
  label: string;
  tone: Tone;
  // What the directive's argument means, if the writer should be able to edit it.
  argLabel?: string;
}

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

export function directiveInfo(name: string): DirectiveInfo {
  return ADMONITIONS[name] ?? OTHER[name] ?? { label: name, tone: 'neutral', argLabel: 'Argument' };
}

// Callouts offered in the Insert menu and the type switcher, in display order.
export const CALLOUT_CHOICES = ['note', 'tip', 'important', 'warning', 'caution', 'danger', 'seealso', 'admonition'];

// Small inline icons; emoji fonts aren't reliable on Linux desktops.
export const ICONS: Record<Tone, string> = {
  note: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7v4.5M8 4.6v.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  info: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4v4.5M8 11.4v.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  tip: '<svg viewBox="0 0 16 16"><path d="M8 1.5a4.5 4.5 0 0 0-2.6 8.2V12h5.2V9.7A4.5 4.5 0 0 0 8 1.5zM6 14h4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  warning: '<svg viewBox="0 0 16 16"><path d="M8 1.8 15 14H1z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6v4M8 12v.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  danger: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m5.5 5.5 5 5m0-5-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  neutral: '<svg viewBox="0 0 16 16"><rect x="2" y="2.5" width="12" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5 6h6M5 9h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
};

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
