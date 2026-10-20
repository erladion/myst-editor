// Getting around: Go to page (Ctrl+P) and the outline of the open page.
import { useEffect, useMemo, useRef, useState } from 'react';
import { rankPages } from '../pages';

interface GoToProps {
  files: string[];
  titles: Record<string, string>;
  recent: string[];
  onOpen: (path: string) => void;
  onClose: () => void;
}

export function GoToPage({ files, titles, recent, onOpen, onClose }: GoToProps) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const found = useMemo(() => rankPages(query, files, titles, recent), [query, files, titles, recent]);
  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    list.current?.children[index]?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  const pick = (path: string | undefined) => {
    if (!path) return;
    onClose();
    onOpen(path);
  };
  return (
    <div className="modal-backdrop goto-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal goto" role="dialog" aria-modal="true" aria-label="Go to page">
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="goto-list"
          aria-activedescendant={found[index] ? `goto-${index}` : undefined}
          aria-label="Page to go to"
          placeholder="Go to page: type part of its title or file name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setIndex((i) => Math.min(i + 1, found.length - 1));
            else if (e.key === 'ArrowUp') setIndex((i) => Math.max(i - 1, 0));
            else if (e.key === 'Enter') pick(found[index]);
            else if (e.key === 'Escape') onClose();
            else return;
            e.preventDefault();
          }}
        />
        <ul id="goto-list" role="listbox" ref={list} className="goto-list">
          {found.map((path, i) => (
            <li
              key={path}
              id={`goto-${i}`}
              role="option"
              aria-selected={i === index}
              className={i === index ? 'active' : undefined}
              onMouseMove={() => setIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(path);
              }}
            >
              <span className="goto-title">{titles[path] ?? path.split('/').pop()}</span>
              <span className="goto-path">{path}</span>
            </li>
          ))}
          {!found.length && <li className="muted goto-none">No page matches “{query}”.</li>}
        </ul>
      </div>
    </div>
  );
}

export interface Heading {
  level: number; // 1–6
  text: string;
  at: number; // where it is: a document position (formatted view) or a line (Markdown view)
}

// The headings of a Markdown text, by line (for the Markdown view): # headings and
// underlined ones, not inside fenced code.
export function markdownHeadings(text: string): Heading[] {
  const lines = text.split('\n');
  const out: Heading[] = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const f = /^\s*(`{3,}|~{3,}|:{3,})/.exec(line)?.[1];
    if (f) {
      if (!fence) fence = f[0];
      else if (f[0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const atx = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (atx) out.push({ level: atx[1].length, text: atx[2], at: i + 1 });
    else if (line.trim() && /^ {0,3}(=+|-+)\s*$/.test(lines[i + 1] ?? '') && !/^\s*[-*+]\s/.test(line)) out.push({ level: lines[i + 1].trim()[0] === '=' ? 1 : 2, text: line.trim(), at: i + 1 });
  }
  return out;
}

interface OutlineProps {
  headings: Heading[];
  current: number | null; // index of the heading the writer is in
  onPick: (h: Heading) => void;
  onClose: () => void;
}

export function Outline({ headings, current, onPick, onClose }: OutlineProps) {
  const top = Math.min(...headings.map((h) => h.level), 6);
  const list = useRef<HTMLUListElement>(null);
  // Keep the heading the writer is in visible in a long outline.
  useEffect(() => {
    if (current !== null) list.current?.children[current]?.scrollIntoView({ block: 'nearest' });
  }, [current]);
  return (
    <nav className="outline" aria-label="Outline">
      <div className="outline-header">
        <span>On this page</span>
        <button type="button" className="link-button" onClick={onClose} title="Hide the outline (Ctrl+Shift+O)">
          Hide
        </button>
      </div>
      {headings.length ? (
        <ul ref={list}>
          {headings.map((h, i) => (
            <li key={`${h.at}-${i}`}>
              <button
                type="button"
                className={`outline-item${i === current ? ' current' : ''}`}
                aria-current={i === current ? 'location' : undefined}
                style={{ paddingLeft: 12 + (h.level - top) * 12 }}
                onClick={() => onPick(h)}
                title={h.text}
              >
                {h.text}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted pad">This page has no headings.</p>
      )}
    </nav>
  );
}
