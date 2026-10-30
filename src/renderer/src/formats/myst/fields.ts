// A field list (:name: value lines, the fieldlist extension): shown as a table of its
// fields, edited in a form while each value is on one line.
import { FIELD } from '../../../../core/myst/parse';
import type { Field } from '../../editor/context';

interface Entry {
  name: string;
  value: string;
  lines: string[]; // as written
}

function entries(source: string): Entry[] {
  const out: Entry[] = [];
  for (const line of source.split('\n')) {
    const m = FIELD.exec(line);
    if (m) out.push({ name: m[1], value: m[2] ?? '', lines: [line] });
    else if (out.length) {
      const last = out[out.length - 1];
      last.lines.push(line);
      last.value += `\n${line.trim()}`;
    }
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

export function fieldsForm(source: string): { title: string; fields: Field[]; source(values: Record<string, string>): string } | null {
  const all = entries(source);
  if (all.some((e) => e.lines.length > 1)) return null; // values over lines: edited as written
  return {
    title: 'Edit fields',
    fields: [
      ...all.map((e, i) => ({ key: `f${i}`, label: e.name, value: e.value, help: i === all.length - 1 ? 'Empty: the field goes.' : undefined })),
      { key: 'new', label: 'Another field', value: '', placeholder: 'name: value' },
    ],
    source(values) {
      const lines = all.flatMap((e, i) => {
        const value = values[`f${i}`].trim();
        if (!value) return [];
        return value === e.value ? e.lines : [`:${e.name}: ${value}`];
      });
      const added = /^:?([^:\s][^:]*?):\s*(.*)$/.exec(values.new.trim());
      if (added && added[2]) lines.push(`:${added[1]}: ${added[2]}`);
      return lines.join('\n') || source;
    },
  };
}
