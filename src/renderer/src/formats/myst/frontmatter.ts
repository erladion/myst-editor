// A page's front matter (YAML between --- lines): shown as its settings, edited in a
// form. A changed value is replaced where it's written, so the rest of the YAML (its
// comments, its quoting, its order) stays as it was.
import { isMap, isScalar, parseDocument, stringify, type Document, type Scalar } from 'yaml';
import type { Field } from '../../editor/context';

interface Setting {
  path: (string | number)[];
  label: string; // its keys, with dots: html_meta.description
  value: string;
  node: Scalar;
}

function split(source: string): { open: string; yaml: string; close: string } | null {
  const m = /^(---[ \t]*\n)([\s\S]*?)(\n---[ \t]*)$/.exec(source) ?? /^(---[ \t]*\n)()(---[ \t]*)$/.exec(source);
  return m ? { open: m[1], yaml: m[2], close: m[3] } : null;
}

// Its settings with a value of one line (numbers, true/false, text), at any depth.
function settings(doc: Document): Setting[] {
  const out: Setting[] = [];
  const visit = (node: unknown, path: (string | number)[]) => {
    if (!isMap(node)) return;
    for (const pair of node.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : null;
      if (key === null) continue;
      const here = [...path, key];
      if (isScalar(pair.value) && pair.value.range && !/\n/.test(String(pair.value.value ?? ''))) {
        out.push({ path: here, label: here.join('.'), value: pair.value.value === null ? '' : String(pair.value.value), node: pair.value });
      } else visit(pair.value, here);
    }
  };
  visit(doc.contents, []);
  return out;
}

// A value as YAML would write it: true, 3, plain text, or quoted where it must be.
function written(value: string, was: Scalar): string {
  if (typeof was.value === 'boolean' && /^(true|false)$/i.test(value)) return value.toLowerCase();
  if (typeof was.value === 'number' && value.trim() && !Number.isNaN(Number(value))) return value.trim();
  return stringify(value).trimEnd();
}

export function frontMatterPreview(source: string): DocumentFragment {
  const out = document.createDocumentFragment();
  const parts = split(source);
  if (!parts) return out;
  const table = document.createElement('table');
  table.className = 'field-list';
  for (const s of settings(parseDocument(parts.yaml))) {
    const row = table.insertRow();
    const name = document.createElement('th');
    name.textContent = s.label;
    row.append(name);
    row.insertCell().textContent = s.value;
  }
  out.append(table);
  return out;
}

export function frontMatterForm(source: string): { title: string; fields: Field[]; source(values: Record<string, string>): string } | null {
  const parts = split(source);
  if (!parts) return null;
  const doc = parseDocument(parts.yaml);
  if (doc.errors.length) return null;
  const all = settings(doc);
  return {
    title: 'Page settings',
    fields: [
      ...all.map((s, i) => ({ key: `s${i}`, label: s.label, value: s.value, help: i === all.length - 1 ? 'Empty: the setting goes.' : undefined })),
      { key: 'new', label: 'Another setting', value: '', placeholder: 'name: value' },
    ],
    source(values) {
      let yaml = parts.yaml;
      // From the end, so earlier offsets stay right.
      const changes = all
        .map((s, i) => ({ s, value: values[`s${i}`].trim() }))
        .filter(({ s, value }) => value !== s.value)
        .sort((a, b) => b.s.node.range![0] - a.s.node.range![0]);
      for (const { s, value } of changes) {
        const [from, to] = s.node.range!;
        if (value) yaml = yaml.slice(0, from) + written(value, s.node) + yaml.slice(to);
        else {
          // The setting's line goes.
          const start = yaml.lastIndexOf('\n', from - 1) + 1;
          const end = yaml.indexOf('\n', to);
          yaml = yaml.slice(0, start) + (end < 0 ? '' : yaml.slice(end + 1));
        }
      }
      const added = /^([\w.-]+)\s*:\s*(.+)$/.exec(values.new.trim());
      if (added) {
        // As typed (2, true, text), quoted only where YAML would read it otherwise.
        const raw = parseDocument(`${added[1]}: ${added[2]}`).errors.length ? stringify(added[2]).trimEnd() : added[2];
        yaml = `${yaml.replace(/\n*$/, '')}${yaml.trim() ? '\n' : ''}${added[1]}: ${raw}`;
      }
      return `${parts.open}${yaml.replace(/\n+$/, '')}${yaml.trim() ? '\n' : ''}${parts.close.replace(/^\n/, '')}`;
    },
  };
}
