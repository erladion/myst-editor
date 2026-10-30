// A field list (:name: value lines, the fieldlist extension): shown as a table of its
// fields, edited in a form. A value over lines keeps its lines' indentation among them.
import { FIELD } from '../../../../core/myst/parse';
import type { CardForm } from '../editing';

interface Entry {
  name: string;
  value: string; // its lines, the ones after its first without the indentation they share
  lines: string[]; // as written
  indent: string; // the indentation of the lines after its first ("  " if it has none)
}

function entries(source: string): Entry[] {
  const out: Entry[] = [];
  for (const line of source.split('\n')) {
    const m = FIELD.exec(line);
    if (m) out.push({ name: m[1], value: m[2] ?? '', lines: [line], indent: '  ' });
    else if (out.length) out[out.length - 1].lines.push(line);
  }
  for (const e of out) {
    const rest = e.lines.slice(1);
    if (!rest.length) continue;
    e.indent = rest.filter((l) => l.trim()).reduce((a, l) => (/^[ \t]*/.exec(l)![0].length < a.length ? /^[ \t]*/.exec(l)![0] : a), /^[ \t]*/.exec(rest[0])![0]);
    e.value = [e.value, ...rest.map((l) => l.slice(e.indent.length))].join('\n');
  }
  return out;
}

export function fieldsPreview(source: string): DocumentFragment {
  const table = document.createElement('table');
  table.className = 'field-list';
  for (const e of entries(source)) {
    const row = table.insertRow();
    const name = document.createElement('th');
    name.textContent = e.name;
    row.append(name);
    row.insertCell().textContent = e.value;
  }
  const out = document.createDocumentFragment();
  out.append(table);
  return out;
}

export function fieldsForm(source: string): CardForm | null {
  const all = entries(source);
  return {
    title: 'Edit fields',
    fields: [
      ...all.map((e, i) => ({
        key: `f${i}`,
        label: e.name,
        value: e.value,
        ...(e.lines.length > 1 ? { lines: Math.min(10, e.lines.length + 1) } : {}),
        help: i === all.length - 1 ? 'Empty: the field goes.' : undefined,
      })),
      { key: 'new', label: 'Another field', value: '', placeholder: 'name: value' },
    ],
    source(values) {
      const lines = all.flatMap((e, i) => {
        const value = values[`f${i}`].replace(/\s+$/, '');
        if (!value.trim()) return [];
        if (value === e.value || value.trim() === e.value) return e.lines;
        const [first, ...rest] = value.replace(/^\s*\n/, '').split('\n');
        return [`:${e.name}:${first.trim() ? ` ${first.trim()}` : ''}`, ...rest.map((l) => (l.trim() ? e.indent + l : ''))];
      });
      const added = /^:?([^:\s][^:]*?):\s*(.*)$/.exec(values.new.trim());
      if (added && added[2]) lines.push(`:${added[1]}: ${added[2]}`);
      return lines.join('\n') || source;
    },
  };
}
