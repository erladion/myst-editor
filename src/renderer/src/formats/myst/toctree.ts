// A toctree edited in a form: its caption, its depth, whether the page shows it, and its
// entries, a line each. What the form doesn't change stays as written.
import { splitDirective } from '../../../../core/directive';
import type { CardForm } from '../editing';

const OPTION = /^[ \t]*:([\w.-]+):(?:[ \t]+(.*))?$/;

export function toctreeForm(source: string): CardForm | null {
  const d = splitDirective(source);
  if (!d || d.name !== 'toctree') return null;
  const header = d.header.split('\n');
  if (header.some((l) => l.trim() === '---')) return null; // options as YAML: edited as written
  const option = (name: string) => d.options.find(([k]) => k === name);
  const entries = d.body ?? '';
  return {
    title: 'Table of contents',
    fields: [
      { key: 'caption', label: 'Caption', value: option('caption')?.[1] ?? '', placeholder: 'Contents', help: 'Shown above the entries, and in the navigation.' },
      { key: 'maxdepth', label: 'Depth', value: option('maxdepth')?.[1] ?? '', placeholder: 'all', help: 'How many levels of headings the entries show: 1 for the pages’ titles only.' },
      {
        key: 'hidden',
        label: 'Shown',
        value: option('hidden') ? 'hidden' : '',
        choices: [
          { value: '', label: 'On the page and in the navigation' },
          { value: 'hidden', label: 'Only in the navigation' },
        ],
      },
      {
        key: 'entries',
        label: 'Pages',
        value: entries,
        lines: Math.min(14, Math.max(4, entries.split('\n').length + 1)),
        placeholder: 'install\nusage/first-steps',
        help: 'A page a line, without its extension. Title <page> gives it another title; https://… links outside.',
      },
    ],
    source(values) {
      const wanted: Record<string, string | null> = {
        caption: values.caption.trim() || null,
        maxdepth: values.maxdepth.trim() || null,
        hidden: values.hidden ? '' : null,
      };
      const line = (k: string, v: string) => (v ? `:${k}: ${v}` : `:${k}:`);
      // The options as written, the changed ones replaced, removed ones gone.
      const opts: string[] = [];
      let blank = false;
      for (const l of header.slice(1)) {
        const m = OPTION.exec(l);
        if (!m) {
          if (!l.trim()) blank = true;
          continue;
        }
        const k = m[1];
        if (!(k in wanted)) opts.push(l);
        else if (wanted[k] !== null) {
          opts.push((m[2] ?? '').trim() === wanted[k] ? l : line(k, wanted[k]!));
          delete wanted[k];
        } else delete wanted[k];
      }
      for (const [k, v] of Object.entries(wanted)) if (v !== null) opts.push(line(k, v));

      const body = values.entries === entries ? entries : values.entries.replace(/[ \t]+$/gm, '').replace(/^\n+|\n+$/g, '');
      const out = [header[0], ...opts];
      if (body) {
        if (opts.length && (blank || d.body === null)) out.push('');
        out.push(body);
      }
      if (d.closing) out.push(d.closing);
      return out.join('\n');
    },
  };
}
