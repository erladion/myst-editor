// Link definitions ([name]: url "title", for links written [text][name]): shown as their
// names and addresses, edited in a form. A changed address keeps the title it had.
import { DEFINITION } from '../../../../core/myst/parse';
import type { CardForm } from '../editing';

interface Definition {
  name: string;
  url: string; // as written, <…> or not
  title: string | null; // as written, quotes and all
  line: string;
}

function definitions(source: string): Definition[] {
  return source.split('\n').flatMap((line) => {
    const m = DEFINITION.exec(line);
    return m ? [{ name: m[1], url: m[2], title: m[3] ?? null, line }] : [];
  });
}

const bare = (url: string) => url.replace(/^<(.*)>$/, '$1');

export function definitionsPreview(source: string): DocumentFragment {
  const table = document.createElement('table');
  table.className = 'field-list link-targets';
  for (const d of definitions(source)) {
    const row = table.insertRow();
    const name = document.createElement('th');
    name.textContent = d.name;
    row.append(name);
    const cell = row.insertCell();
    cell.textContent = bare(d.url);
    if (d.title) cell.title = d.title.slice(1, -1);
  }
  const out = document.createDocumentFragment();
  out.append(table);
  return out;
}

export function definitionsForm(source: string): CardForm | null {
  const all = definitions(source);
  if (!all.length || all.length !== source.split('\n').length) return null;
  return {
    title: all.length === 1 ? 'Link target' : 'Link targets',
    fields: [
      ...all.map((d, i) => ({ key: `d${i}`, label: `[${d.name}]`, value: bare(d.url), help: i === all.length - 1 ? 'Empty: the link target goes.' : undefined })),
      { key: 'new', label: 'Another link target', value: '', placeholder: 'name: https://example.com', help: 'Links written [text][name] go to its address.' },
    ],
    source(values) {
      const lines = all.flatMap((d, i) => {
        const url = values[`d${i}`].trim();
        if (!url) return [];
        if (url === bare(d.url)) return [d.line];
        const written = /\s/.test(url) ? `<${url}>` : url;
        return [`[${d.name}]: ${written}${d.title ? ` ${d.title}` : ''}`];
      });
      const added = /^\[?([^\]:]+?)\]?:\s*(\S+)$/.exec(values.new.trim());
      if (added) lines.push(`[${added[1].trim()}]: ${added[2]}`);
      return lines.join('\n') || source;
    },
  };
}
