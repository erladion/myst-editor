// The app's own title bar, as in VS Code: the menus (from the application menu, so
// they match it and its shortcuts), the window's title, and room on the right for the
// window buttons the system draws. Not shown when the system draws the title bar.
import { useEffect, useRef, useState } from 'react';
import type { AppMenuItem } from '../../../shared/api';
import icon from '../../../../build/icon.png';
import { PRODUCT } from '../../../shared/product';

const api = window.myst;

const usable = (i: AppMenuItem) => i.type !== 'separator' && i.enabled;

// The next usable item from `from` (-1: before the first), around at the ends.
function step(items: AppMenuItem[], from: number, by: 1 | -1) {
  for (let n = 1; n <= items.length; n++) {
    const i = (((from + by * n) % items.length) + items.length) % items.length;
    if (usable(items[i])) return i;
  }
  return -1;
}

// The highlighted item: in the open menu, or in its open submenu.
type Active = { inSub: boolean; index: number } | null;

export function TitleBar() {
  const [menu, setMenu] = useState<AppMenuItem[] | null>(null);
  const [title, setTitle] = useState<string>(PRODUCT.name);
  // The open menu, the open submenu in it (index of its item), and the highlighted item.
  const [open, setOpen] = useState<number | null>(null);
  const [sub, setSub] = useState<number | null>(null);
  const [active, setActive] = useState<Active>(null);
  const bar = useRef<HTMLElement>(null);
  // Opened from the keyboard: where the focus was, to give it back. (With the mouse,
  // the focus stays in the page throughout, so Cut and Copy act on its selection.)
  const before = useRef<HTMLElement | null>(null);

  useEffect(() => {
    void api.appMenu().then((m) => {
      if (!m) return;
      setMenu(m.menu);
      setTitle(m.title);
    });
    const offMenu = api.onAppMenu(setMenu);
    const offTitle = api.onWindowTitle(setTitle);
    return () => {
      offMenu();
      offTitle();
    };
  }, []);

  const openMenu = (t: number, highlightFirst: boolean) => {
    setOpen(t);
    setSub(null);
    const first = menu ? step(menu[t].submenu ?? [], -1, 1) : -1;
    setActive(highlightFirst && first >= 0 ? { inSub: false, index: first } : null);
  };

  const close = () => {
    setOpen(null);
    setSub(null);
    setActive(null);
    if (before.current?.isConnected) before.current.focus();
    before.current = null;
  };

  const run = (path: number[]) => {
    close();
    // Once the focus is back where it was, so Cut and Paste act there.
    requestAnimationFrame(() => api.clickMenu(path));
  };

  // F10 opens the first menu from the keyboard, as in most desktops.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F10' || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || !menu?.length || open !== null) return;
      e.preventDefault();
      before.current = document.activeElement as HTMLElement | null;
      openMenu(0, true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // While a menu is open: the keys move through it, and a click elsewhere closes it.
  useEffect(() => {
    if (open === null || !menu) return;
    const items = menu[open].submenu ?? [];
    const subItems = sub !== null ? (items[sub]?.submenu ?? []) : [];
    const onKey = (e: KeyboardEvent) => {
      const inSub = !!active?.inSub && sub !== null;
      const list = inSub ? subItems : items;
      const index = active?.index ?? -1;
      const item = index >= 0 ? list[index] : undefined;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowDown') setActive({ inSub, index: step(list, index, 1) });
      else if (e.key === 'ArrowUp') setActive({ inSub, index: step(list, index < 0 ? 0 : index, -1) });
      else if (e.key === 'ArrowRight') {
        if (!inSub && item?.type === 'submenu') {
          setSub(index);
          setActive({ inSub: true, index: step(item.submenu ?? [], -1, 1) });
        } else openMenu((open + 1) % menu.length, true);
      } else if (e.key === 'ArrowLeft') {
        if (inSub) setActive({ inSub: false, index: sub! });
        else openMenu((open - 1 + menu.length) % menu.length, true);
        if (inSub) setSub(null);
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (!item || !usable(item)) return;
        if (item.type === 'submenu') {
          setSub(index);
          setActive({ inSub: true, index: step(item.submenu ?? [], -1, 1) });
        } else run(inSub ? [open, sub!, index] : [open, index]);
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onDown = (e: MouseEvent) => !bar.current?.contains(e.target as Node) && close();
    const onBlur = () => close();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('blur', onBlur);
    };
  });

  // From the keyboard, the focus follows the highlight (for screen readers).
  useEffect(() => {
    if (!before.current || !active || open === null) return;
    const list = bar.current?.querySelector(active.inSub ? '.titlebar-submenu' : `[data-menu="${open}"] > .titlebar-items`);
    list?.children[active.index]?.querySelector<HTMLButtonElement>(':scope > button')?.focus();
  }, [active, open, sub]);

  if (!menu) return null;

  const list = (items: AppMenuItem[], path: number[], inSub: boolean) => (
    <ul className={inSub ? 'titlebar-submenu' : 'titlebar-items'} role="menu">
      {items.map((item, i) => {
        if (item.type === 'separator') return <li key={i} role="separator" className="titlebar-separator" />;
        const highlighted = active?.inSub === inSub && active.index === i;
        return (
          <li key={i} role="none" className={!inSub && sub === i ? 'open' : undefined}>
            <button
              type="button"
              className={highlighted ? 'active' : undefined}
              role={item.type === 'checkbox' ? 'menuitemcheckbox' : item.type === 'radio' ? 'menuitemradio' : 'menuitem'}
              aria-checked={item.type === 'checkbox' || item.type === 'radio' ? !!item.checked : undefined}
              aria-haspopup={item.type === 'submenu' ? 'menu' : undefined}
              aria-expanded={item.type === 'submenu' ? !inSub && sub === i : undefined}
              disabled={!item.enabled}
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => {
                if (!inSub) setSub(item.type === 'submenu' ? i : null);
                setActive({ inSub, index: i });
              }}
              onClick={() => (item.type === 'submenu' ? setSub(i) : run([...path, i]))}
            >
              <span className="titlebar-check">{item.checked ? (item.type === 'radio' ? '•' : '✓') : ''}</span>
              <span className="titlebar-label">{item.label}</span>
              <span className="titlebar-shortcut">{item.type === 'submenu' ? '›' : (item.shortcut ?? '')}</span>
            </button>
            {!inSub && sub === i && item.submenu && list(item.submenu, [...path, i], true)}
          </li>
        );
      })}
    </ul>
  );

  return (
    <header className="titlebar" ref={bar}>
      <img className="titlebar-icon" src={icon} alt="" draggable={false} />
      <nav className="titlebar-menus" role="menubar" aria-label="Menu">
        {menu.map((top, t) => (
          <div key={t} className={`titlebar-menu${open === t ? ' open' : ''}`} data-menu={t}>
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={open === t}
              tabIndex={-1}
              onMouseDown={(e) => {
                e.preventDefault();
                if (open === t) close();
                else openMenu(t, false);
              }}
              onMouseEnter={() => open !== null && open !== t && openMenu(t, false)}
            >
              {top.label}
            </button>
            {open === t && top.submenu && list(top.submenu, [t], false)}
          </div>
        ))}
      </nav>
      <div className="titlebar-title">{title}</div>
    </header>
  );
}
