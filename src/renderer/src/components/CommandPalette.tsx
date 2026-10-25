// Ctrl+Shift+P (or M-x): every command by its name. The menus' items (from the main
// process, clicked there as the title bar's are) and the page's editing commands.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppMenuItem } from '../../../shared/api';
import type { PaletteCommand } from '../app/palette';

const api = window.myst;

// The menus' items, as commands: "View › Appearance › Dark".
function fromMenu(items: AppMenuItem[], path: number[] = [], names: string[] = []): PaletteCommand[] {
  return items.flatMap((item, i) => {
    if (item.type === 'separator' || !item.enabled) return [];
    if (item.submenu) return fromMenu(item.submenu, [...path, i], [...names, item.label]);
    const at = [...path, i];
    return [{ id: `menu:${at.join('.')}`, group: names.join(' › '), label: item.label, keys: item.shortcut, run: () => api.clickMenu(at) }];
  });
}

// Every word typed, found at the start of a word of the command (or anywhere in it,
// ranked lower).
function score(c: PaletteCommand, words: string[]): number {
  const text = `${c.group} ${c.label}`.toLowerCase();
  const starts = text.split(/[^a-z0-9]+/);
  let total = 0;
  for (const w of words) {
    if (starts.some((s) => s.startsWith(w))) total += 2;
    else if (text.includes(w)) total += 1;
    else return 0;
  }
  return total;
}

export function CommandPalette({ commands, onClose }: { commands: PaletteCommand[]; onClose: () => void }) {
  const [menu, setMenu] = useState<PaletteCommand[]>([]);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    void api.menuCommands().then((items) => setMenu(fromMenu(items)));
  }, []);
  const shown = useMemo(() => {
    const all = [...commands, ...menu];
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return all;
    return all
      .map((c, i) => ({ c, i, s: score(c, words) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((x) => x.c);
  }, [commands, menu, query]);
  useEffect(() => setIndex(0), [query]);
  // (In braces: scrollIntoView returns a promise now, which an effect mustn't.)
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  // Run at once (the page's commands put the focus back in it), so what's typed next
  // follows the command; then the palette goes.
  const choose = (c: PaletteCommand | undefined) => {
    if (!c) return;
    c.run();
    onClose();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = shown.length;
      if (n) setIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(shown[index]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };
  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          className="palette-input"
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={shown[index] ? `palette-${index}` : undefined}
          aria-label="Command"
          placeholder="Type a command"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
        />
        <ul id="palette-list" className="palette-list" role="listbox" ref={list}>
          {shown.slice(0, 200).map((c, i) => (
            <li
              key={c.id}
              id={`palette-${i}`}
              role="option"
              aria-selected={i === index}
              className={i === index ? 'selected' : undefined}
              onMouseMove={() => setIndex(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(c)}
            >
              <span className="palette-group">{c.group}</span>
              <span className="palette-label">{c.label}</span>
              {c.keys && <kbd>{c.keys}</kbd>}
            </li>
          ))}
          {!shown.length && <li className="palette-none muted">No command has those words.</li>}
        </ul>
      </div>
    </div>
  );
}
