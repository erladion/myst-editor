// A page's earlier versions: the app's own (kept before saves) and its commits. Each
// can be seen as it looked, or as what has changed since, and put back.
import { useEffect, useMemo, useState } from 'react';
import { diffLines } from 'diff';
import type { PageVersion } from '../../../shared/git';
import type { EditorContext } from '../editor/context';
import { LivePreview } from './LivePreview';

interface Props {
  path: string;
  title: string;
  current: string; // the page as it is now
  ctx: EditorContext;
  onRestore: (text: string, version: PageVersion) => void;
  onClose: () => void;
}

const api = window.myst;

// "Today 14:02", "Yesterday 09:15", "3 Oct 14:02", or with the year when it isn't this one.
export function when(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (that === day) return `Today ${time}`;
  if (that === day - 86_400_000) return `Yesterday ${time}`;
  const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) });
  return `${date} ${time}`;
}

export function HistoryDialog({ path, title, current, ctx, onRestore, onClose }: Props) {
  const [versions, setVersions] = useState<PageVersion[] | null>(null);
  const [selected, setSelected] = useState<PageVersion | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [show, setShow] = useState<'version' | 'changes'>('changes');
  useEffect(() => {
    void api.pageHistory(path).then((v) => {
      setVersions(v);
      setSelected(v[0] ?? null);
    });
  }, [path]);
  useEffect(() => {
    setText(null);
    if (selected) void api.pageVersion(path, selected).then((t) => setText(t ?? ''));
  }, [path, selected]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const same = text !== null && text.replace(/\r\n/g, '\n') === current.replace(/\r\n/g, '\n');
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal history" role="dialog" aria-modal="true" aria-label="Page history">
        <h2>History of “{title}”</h2>
        <div className="history-body">
          <ul className="history-list" role="listbox" aria-label="Earlier versions">
            {versions === null && <li className="muted">Looking…</li>}
            {versions?.length === 0 && (
              <li className="muted history-none">No earlier versions yet. The app keeps one before you change a page, and git keeps every commit.</li>
            )}
            {versions?.map((v) => (
              <li
                key={`${v.kind}-${v.id}`}
                role="option"
                aria-selected={v === selected}
                className={v === selected ? 'active' : undefined}
                onClick={() => setSelected(v)}
              >
                <span className="history-when">{when(v.date)}</span>
                <span className="history-what">{v.kind === 'commit' ? `${v.message} — ${v.author}` : 'Before your edits (kept by the app)'}</span>
              </li>
            ))}
          </ul>
          <div className="history-view">
            {selected && (
              <div className="history-tabs" role="tablist" aria-label="Show">
                <button type="button" role="tab" aria-selected={show === 'changes'} onClick={() => setShow('changes')}>
                  Changes since
                </button>
                <button type="button" role="tab" aria-selected={show === 'version'} onClick={() => setShow('version')}>
                  This version
                </button>
              </div>
            )}
            {selected && text === null && <p className="muted pad">Loading…</p>}
            {selected && text !== null && show === 'version' && (
              <div className="history-preview">
                <LivePreview text={text} ctx={ctx} savedText={text} build={null} viewAs={null} line={null} onPick={() => {}} />
              </div>
            )}
            {selected && text !== null && show === 'changes' && (same ? <p className="muted pad">The page is the same now as in this version.</p> : <Changes from={text} to={current} />)}
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button type="button" className="primary" disabled={!selected || text === null || same} onClick={() => selected && text !== null && onRestore(text, selected)}>
            Restore this version
          </button>
        </div>
      </div>
    </div>
  );
}

// What changed from an earlier version to now, line by line, with unchanged stretches
// folded away except a little around each change.
export function Changes({ from, to, labels = ['Only in this version', 'Added since'] }: { from: string; to: string; labels?: [string, string] }) {
  const parts = useMemo(() => diffLines(from.replace(/\r\n/g, '\n'), to.replace(/\r\n/g, '\n')), [from, to]);
  const CONTEXT = 2;
  const rows: { kind: 'add' | 'del' | 'same' | 'fold'; text: string }[] = [];
  parts.forEach((part, i) => {
    const lines = part.value.replace(/\n$/, '').split('\n');
    if (part.added || part.removed) {
      for (const l of lines) rows.push({ kind: part.added ? 'add' : 'del', text: l });
      return;
    }
    // Unchanged: keep a few lines next to changes on either side.
    const keepStart = i > 0 ? CONTEXT : 0;
    const keepEnd = i < parts.length - 1 ? CONTEXT : 0;
    if (lines.length <= keepStart + keepEnd + 1) lines.forEach((l) => rows.push({ kind: 'same', text: l }));
    else {
      lines.slice(0, keepStart).forEach((l) => rows.push({ kind: 'same', text: l }));
      rows.push({ kind: 'fold', text: `${lines.length - keepStart - keepEnd} unchanged lines` });
      lines.slice(lines.length - keepEnd).forEach((l) => rows.push({ kind: 'same', text: l }));
    }
  });
  return (
    <div className="history-changes" aria-label="Changes since this version">
      <p className="history-legend">
        <span className="del">{labels[0]}</span> <span className="add">{labels[1]}</span>
      </p>
      <pre>
        {rows.map((r, i) => (
          <div key={i} className={`diff-${r.kind}`}>
            {r.kind === 'add' ? '+ ' : r.kind === 'del' ? '− ' : r.kind === 'fold' ? '' : '  '}
            {r.text}
          </div>
        ))}
      </pre>
    </div>
  );
}
