// Vale's alerts in the formatted view: the text underlined, and on a click, what Vale
// says about it with its corrections to pick from.
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import type { LocatedAlert } from '../../../core/vale';
import type { ValeAlert } from '../../../shared/vale';

export const valeKey = new PluginKey<DecorationSet>('vale');

export function setVale(tr: Transaction, located: LocatedAlert[]): Transaction {
  const decorations = located.map(({ from, to, alert }) =>
    // No title: hovering shows the popup, in the app's colours (see Popup).
    Decoration.inline(from, to, { class: `vale vale-${alert.Severity}` }, { alert }),
  );
  return tr.setMeta(valeKey, DecorationSet.create(tr.doc, decorations)).setMeta('addToHistory', false);
}

const alertAt = (state: EditorState, pos: number) => {
  const found = valeKey.getState(state)?.find(pos, pos, (spec) => !!spec.alert) ?? [];
  // The innermost: the one that starts last.
  const d = found.filter((x) => x.from <= pos && pos < x.to).sort((a, b) => b.from - a.from)[0];
  return d ? { from: d.from, to: d.to, alert: (d.spec as { alert: ValeAlert }).alert } : null;
};

// What "Accept" does (set by the editor): add the word to Vale's vocabulary.
const acceptors = new WeakMap<EditorView, (word: string) => void>();
export function setAccept(view: EditorView, accept: ((word: string) => void) | null) {
  if (accept) acceptors.set(view, accept);
  else acceptors.delete(view);
}

type Hit = { from: number; to: number; alert: ValeAlert };

// Opened by a click it stays until a click elsewhere (or Escape); opened by hovering,
// it goes a moment after the mouse leaves both the word and the popup.
class Popup {
  private dom: HTMLElement | null = null;
  private shown: ValeAlert | null = null;
  private pinned = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private close = () => this.hide();
  constructor(private view: EditorView) {}

  hoverEnter(hit: Hit) {
    clearTimeout(this.timer);
    if (this.shown === hit.alert) return;
    this.timer = setTimeout(() => this.show(hit, false), 300);
  }

  hoverLeave() {
    clearTimeout(this.timer);
    if (this.dom && !this.pinned) this.timer = setTimeout(() => this.hide(), 300);
  }

  show(hit: Hit, pinned = true) {
    clearTimeout(this.timer);
    if (this.shown === hit.alert && this.dom) {
      this.pinned ||= pinned;
      return;
    }
    this.hide();
    const { from, to, alert } = hit;
    this.shown = alert;
    this.pinned = pinned;
    const dom = document.createElement('div');
    dom.className = `vale-popup vale-${alert.Severity}`;
    dom.setAttribute('role', 'dialog');
    dom.setAttribute('aria-label', 'Style check');
    const message = document.createElement('p');
    message.textContent = alert.Message;
    const check = document.createElement('div');
    check.className = 'vale-check';
    if (alert.Link) {
      const a = document.createElement('a');
      a.href = alert.Link;
      a.target = '_blank';
      a.textContent = alert.Check;
      check.append(a);
    } else check.textContent = alert.Check;
    dom.append(message);
    if (alert.Suggestions.length) {
      const list = document.createElement('div');
      list.className = 'vale-suggestions';
      for (const s of alert.Suggestions) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = s || 'Remove it';
        b.title = s ? `Replace “${alert.Match}” with “${s}”` : `Remove “${alert.Match}”`;
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => {
          const { state } = this.view;
          // Still the same text? (It may have been edited since.)
          if (state.doc.textBetween(from, to) === alert.Match) {
            this.view.dispatch(s ? state.tr.insertText(s, from, to) : state.tr.delete(from, to));
          }
          this.hide();
          this.view.focus();
        });
        list.append(b);
      }
      dom.append(list);
    }
    const accept = acceptors.get(this.view);
    if (accept) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'link-button vale-accept';
      b.textContent = `Accept “${alert.Match}”`;
      b.title = 'Add it to the project’s Vale vocabulary, so Vale doesn’t flag it again';
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => {
        accept(alert.Match);
        this.hide();
        this.view.focus();
      });
      check.append(b);
    }
    dom.append(check);
    dom.addEventListener('mouseenter', () => clearTimeout(this.timer));
    dom.addEventListener('mouseleave', () => this.hoverLeave());
    document.body.append(dom);
    const at = this.view.coordsAtPos(from);
    const width = dom.offsetWidth;
    dom.style.left = `${Math.max(8, Math.min(at.left, window.innerWidth - width - 8))}px`;
    dom.style.top = `${at.bottom + 6}px`;
    if (at.bottom + 6 + dom.offsetHeight > window.innerHeight - 8) dom.style.top = `${Math.max(8, at.top - dom.offsetHeight - 6)}px`;
    this.dom = dom;
    setTimeout(() => {
      window.addEventListener('mousedown', this.onOutside, true);
      window.addEventListener('keydown', this.onKey, true);
      window.addEventListener('scroll', this.close, true);
    });
  }

  private onOutside = (e: MouseEvent) => {
    if (!this.dom?.contains(e.target as Node)) this.hide();
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.hide();
    }
  };

  hide() {
    clearTimeout(this.timer);
    this.dom?.remove();
    this.dom = null;
    this.shown = null;
    this.pinned = false;
    window.removeEventListener('mousedown', this.onOutside, true);
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('scroll', this.close, true);
  }
}

const popups = new WeakMap<EditorView, Popup>();

// Go to the next alert after the cursor (round to the first), and open it.
export function nextAlert(view: EditorView): boolean {
  const all = (valeKey.getState(view.state)?.find() ?? []).sort((a, b) => a.from - b.from);
  if (!all.length) return false;
  const d = all.find((x) => x.from > view.state.selection.from) ?? all[0];
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, d.from, d.to)).scrollIntoView());
  view.focus();
  // Once it's scrolled there.
  requestAnimationFrame(() => popups.get(view)?.show({ from: d.from, to: d.to, alert: (d.spec as { alert: ValeAlert }).alert }));
  return true;
}

export function valePlugin() {
  let popup: Popup | null = null;
  return new Plugin<DecorationSet>({
    key: valeKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, set) {
        const next = tr.getMeta(valeKey) as DecorationSet | undefined;
        if (next) return next;
        if (!tr.docChanged) return set;
        // Text that changed is no longer what Vale saw: its alerts go until the next check.
        let mapped = set.map(tr.mapping, tr.doc);
        tr.mapping.maps.forEach((map, i) => {
          const rest = tr.mapping.slice(i + 1);
          map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
            const from = rest.map(newStart, -1);
            const to = rest.map(newEnd, 1);
            mapped = mapped.remove(mapped.find(Math.max(0, from - 1), Math.min(tr.doc.content.size, to + 1)));
          });
        });
        return mapped;
      },
    },
    props: {
      decorations: (state) => valeKey.getState(state),
      handleDOMEvents: {
        mouseover(view, event) {
          const el = (event.target as Element).closest?.('.vale');
          const hit = el && alertAt(view.state, view.posAtDOM(el, 0));
          if (hit) popup?.hoverEnter(hit);
          return false;
        },
        mouseout(_view, event) {
          if ((event.target as Element).closest?.('.vale')) popup?.hoverLeave();
          return false;
        },
      },
      handleClick(view, pos, event) {
        if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey) return false;
        const hit = alertAt(view.state, pos);
        if (hit) popup?.show(hit);
        return false; // the cursor goes there as usual
      },
    },
    view(view) {
      popup = new Popup(view);
      popups.set(view, popup);
      return {
        update: (v, prev) => {
          if (!v.state.doc.eq(prev.doc)) popup?.hide();
        },
        destroy: () => {
          popup?.hide();
          popup = null;
        },
      };
    },
  });
}
