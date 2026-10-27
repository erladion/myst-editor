// How blocks such as callouts look: their tone (colour) and icon.

export type Tone = 'note' | 'info' | 'tip' | 'warning' | 'danger' | 'neutral';

// How a block (a directive, in MyST) is presented: its name for the writer, its tone,
// and what its argument means, if the writer should be able to edit it.
export interface DirectiveInfo {
  label: string;
  tone: Tone;
  argLabel?: string;
}

// Small inline icons; emoji fonts aren't reliable on Linux desktops.
export const ICONS: Record<Tone, string> = {
  note: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 7v4.5M8 4.6v.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  info: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4v4.5M8 11.4v.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  tip: '<svg viewBox="0 0 16 16"><path d="M8 1.5a4.5 4.5 0 0 0-2.6 8.2V12h5.2V9.7A4.5 4.5 0 0 0 8 1.5zM6 14h4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  warning: '<svg viewBox="0 0 16 16"><path d="M8 1.8 15 14H1z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6v4M8 12v.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  danger: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m5.5 5.5 5 5m0-5-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  neutral: '<svg viewBox="0 0 16 16"><rect x="2" y="2.5" width="12" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5 6h6M5 9h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
};
