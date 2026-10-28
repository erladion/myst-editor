// A bottom panel's height (Problems, Checks): dragged with the handle along its top
// edge, taking height from the page and preview above, or with the arrow keys; double
// click for the usual height. Kept for next time.
import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';

const KEY = 'bottom-panel-height';
const MIN = 90;
// What the page above keeps at least.
const ROOM_ABOVE = 160;

const clamp = (h: number) => Math.round(Math.max(MIN, Math.min(h, window.innerHeight - ROOM_ABOVE)));

function stored(): number | null {
  try {
    const h = Number(localStorage.getItem(KEY));
    return h > 0 ? h : null;
  } catch {
    return null;
  }
}

function store(h: number | null) {
  try {
    if (h === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(h));
  } catch {
    // kept for this session only
  }
}

export function usePanelHeight() {
  const ref = useRef<HTMLElement>(null);
  const [height, setHeight] = useState<number | null>(stored);
  const set = (h: number | null) => {
    const next = h === null ? null : clamp(h);
    setHeight(next);
    store(next);
  };
  const current = () => ref.current?.getBoundingClientRect().height ?? height ?? 240;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startHeight = current();
    const move = (ev: globalThis.PointerEvent) => setHeight(clamp(startHeight + startY - ev.clientY));
    const up = (ev: globalThis.PointerEvent) => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      set(startHeight + startY - ev.clientY);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 80 : 20;
    if (e.key === 'ArrowUp') set(current() + step);
    else if (e.key === 'ArrowDown') set(current() - step);
    else return;
    e.preventDefault();
  };

  const style: CSSProperties | undefined = height ? { height, maxHeight: 'none' } : undefined;
  const handle = (
    <div
      className="panel-resize"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the panel"
      aria-valuenow={Math.round(height ?? 0) || undefined}
      tabIndex={0}
      title="Drag to make the panel taller or shorter (double-click: the usual height)"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => set(null)}
    />
  );
  return { ref, style, handle };
}
