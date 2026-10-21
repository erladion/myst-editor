// Search all pages (Ctrl+Shift+F): every match in the folder's pages, by page, in the
// sidebar. Opening a result goes to its line.
import { useEffect, useRef, useState } from 'react';
import type { PageMatches } from '../../../shared/api';

interface Props {
  titles: Record<string, string>;
  focusKey: number; // changes when Ctrl+Shift+F is pressed again: focus the field
  saveAll: () => Promise<boolean>;
  onOpen: (path: string, line: number, query: string, caseSensitive: boolean) => void;
  onClose: () => void;
}

const api = window.myst;

// The line around the match, short enough for the sidebar.
function snippet(text: string, from: number, to: number) {
  const start = Math.max(0, from - 30);
  const end = Math.min(text.length, to + 60);
  return {
    before: (start > 0 ? '…' : '') + text.slice(start, from).trimStart(),
    match: text.slice(from, to),
    after: text.slice(to, end) + (end < text.length ? '…' : ''),
  };
}

export function SearchPanel({ titles, focusKey, saveAll, onOpen, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [found, setFound] = useState<{ results: PageMatches[]; truncated: boolean; query: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const run = useRef(0);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusKey]);

  const search = async (q: string, cs: boolean) => {
    const mine = ++run.current;
    if (!q.trim()) {
      setFound(null);
      return;
    }
    setBusy(true);
    await saveAll(); // so what's found is what's on screen
    const result = await api.searchPages(q, cs);
    if (mine !== run.current) return; // a newer search has started
    setFound({ ...result, query: q });
    setBusy(false);
  };
  // As the text changes, a moment after typing stops.
  useEffect(() => {
    const t = setTimeout(() => void search(query, caseSensitive), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, caseSensitive]);

  const total = found?.results.reduce((n, r) => n + r.matches.length, 0) ?? 0;
  return (
    <section className="search-panel" aria-label="Search all pages">
      <div className="search-header">
        <span>Search all pages</span>
        <button type="button" className="link-button" onClick={onClose} title="Back to the pages (Escape)">
          Close
        </button>
      </div>
      <div className="search-row">
        <input
          ref={input}
          aria-label="Search for"
          placeholder="Text to find in every page"
          value={query}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void search(query, caseSensitive);
            else if (e.key === 'Escape') onClose();
            else return;
            e.preventDefault();
          }}
        />
        <button type="button" className={`tb${caseSensitive ? ' active' : ''}`} aria-pressed={caseSensitive} title="Match upper and lower case" onClick={() => setCaseSensitive(!caseSensitive)}>
          Aa
        </button>
      </div>
      <p className="search-summary muted" aria-live="polite">
        {busy && !found
          ? 'Searching…'
          : found && found.query
            ? total
              ? `${total}${found.truncated ? '+' : ''} match${total === 1 ? '' : 'es'} in ${found.results.length} page${found.results.length === 1 ? '' : 's'}${found.truncated ? ' (the first ones)' : ''}`
              : 'No page has this.'
            : ''}
      </p>
      <div className="search-results">
        {found?.results.map((page) => (
          <div key={page.path} className="search-page" role="group" aria-label={titles[page.path] ?? page.path}>
            <div className="search-page-title" title={page.path}>
              {titles[page.path] ?? page.path.split('/').pop()} <span className="muted">{page.matches.length}</span>
            </div>
            <ul>
              {page.matches.map((m, i) => {
                const s = snippet(m.text, m.from, m.to);
                return (
                  <li key={i}>
                    <button type="button" className="search-match" title={`Line ${m.line}`} onClick={() => onOpen(page.path, m.line, found.query, caseSensitive)}>
                      <span className="search-line">{m.line}</span>
                      <span className="search-text">
                        {s.before}
                        <mark>{s.match}</mark>
                        {s.after}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
