// A page's front matter (YAML between --- lines): shown as its settings, edited in a
// form. A changed value is replaced where it's written, so the rest of the YAML (its
// comments, its quoting, its order) stays as it was.
import { isMap, isScalar, parseDocument, stringify, type Document, type Scalar } from 'yaml';
import type { CardForm } from '../editing';

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

// Its settings with a text value (numbers, true/false, text, text over lines), at any depth.
function settings(doc: Document): Setting[] {
  const out: Setting[] = [];
  const visit = (node: unknown, path: (string | number)[]) => {
    if (!isMap(node)) return;
    for (const pair of node.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : null;
      if (key === null) continue;
      const here = [...path, key];
      if (isScalar(pair.value) && pair.value.range) {
        // A block's text without the line break it ends with.
        const value = pair.value.value === null ? '' : String(pair.value.value).replace(/\n$/, '');
        out.push({ path: here, label: here.join('.'), value, node: pair.value });
      } else visit(pair.value, here);
    }
  };
  visit(doc.contents, []);
  return out;
}

// A value as YAML would write it: true, 3, plain text, or quoted where it must be. Over
// lines, a block (| as it was, |- otherwise) indented under its key at `indent`.
function written(value: string, was: Scalar, yaml: string): string {
  if (typeof was.value === 'boolean' && /^(true|false)$/i.test(value)) return value.toLowerCase();
  if (typeof was.value === 'number' && value.trim() && !Number.isNaN(Number(value))) return value.trim();
  const [from] = was.range!;
  const block = was.type === 'BLOCK_LITERAL' || was.type === 'BLOCK_FOLDED';
  if (!value.includes('\n')) return stringify(value).trimEnd() + (block ? '\n' : '');
  const lineStart = yaml.lastIndexOf('\n', from - 1) + 1;
  const keyIndent = /^[ \t]*/.exec(yaml.slice(lineStart))![0];
  const own = block ? /\n([ \t]+)\S/.exec(yaml.slice(from))?.[1] : undefined;
  const indent = own ?? `${keyIndent}  `;
  const header = was.type === 'BLOCK_LITERAL' && /^\|-?(?=\s)/.exec(yaml.slice(from))?.[0];
  const lines = value.split('\n').map((l) => (l.trim() ? indent + l : ''));
  return `${header || '|-'}\n${lines.join('\n')}${block ? '\n' : ''}`;
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

export function frontMatterForm(source: string): CardForm | null {
  const parts = split(source);
  if (!parts) return null;
  const doc = parseDocument(parts.yaml);
  if (doc.errors.length) return null;
  const all = settings(doc);
  return {
    title: 'Page settings',
    fields: [
      ...all.map((s, i) => ({
        key: `s${i}`,
        label: s.label,
        value: s.value,
        ...(s.value.includes('\n') ? { lines: Math.min(10, s.value.split('\n').length + 1) } : {}),
        help: i === all.length - 1 ? 'Empty: the setting goes.' : undefined,
      })),
      { key: 'new', label: 'Another setting', value: '', placeholder: 'name: value' },
    ],
    source(values) {
      let yaml = parts.yaml;
      // From the end, so earlier offsets stay right.
      const changes = all
        .map((s, i) => ({ s, value: values[`s${i}`].replace(/\s+$/, '').replace(/^\s*\n/, '') }))
        .filter(({ s, value }) => value !== s.value && value.trim() !== s.value)
        .sort((a, b) => b.s.node.range![0] - a.s.node.range![0]);
      for (const { s, value } of changes) {
        const [from, to] = s.node.range!;
        if (value.trim()) yaml = yaml.slice(0, from) + written(value.includes('\n') ? value : value.trim(), s.node, yaml) + yaml.slice(to);
        else {
          // The setting's lines go (a block's end with its last line break).
          const start = yaml.lastIndexOf('\n', from - 1) + 1;
          const end = yaml[to - 1] === '\n' ? to - 1 : yaml.indexOf('\n', to);
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
