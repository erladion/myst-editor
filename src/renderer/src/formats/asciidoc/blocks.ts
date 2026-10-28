// How AsciiDoc's blocks are presented to writers.
import type { DirectiveInfo } from '../../editor/tones';

export const ADMONITIONS: Record<string, DirectiveInfo> = {
  note: { label: 'Note', tone: 'note' },
  tip: { label: 'Tip', tone: 'tip' },
  important: { label: 'Important', tone: 'info' },
  caution: { label: 'Caution', tone: 'warning' },
  warning: { label: 'Warning', tone: 'danger' },
};

const OTHER: Record<string, DirectiveInfo> = {
  figure: { label: 'Figure', tone: 'neutral', argLabel: 'Image' },
  example: { label: 'Example', tone: 'neutral', argLabel: 'Title' },
  sidebar: { label: 'Sidebar', tone: 'neutral', argLabel: 'Title' },
  quote: { label: 'Quote', tone: 'neutral', argLabel: 'Title' },
  open: { label: 'Block', tone: 'neutral' },
  abstract: { label: 'Abstract', tone: 'neutral', argLabel: 'Title' },
  partintro: { label: 'Part introduction', tone: 'neutral', argLabel: 'Title' },
};

export function blockInfo(name: string): DirectiveInfo {
  return ADMONITIONS[name] ?? OTHER[name] ?? { label: name, tone: 'neutral', argLabel: 'Title' };
}

export const CALLOUT_CHOICES = Object.keys(ADMONITIONS);
