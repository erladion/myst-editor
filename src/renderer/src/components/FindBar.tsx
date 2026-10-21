// The find (and replace) bar over the formatted view.
import { useEffect, useRef, useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import { closeFind, findKey, move, replace, search } from '../editor/find';

interface Props {
  view: EditorView;
  initial: string; // the selected text when it opened
  caseSensitive?: boolean; // to start with (from a search of all pages)
  focusKey: number; // changes when Ctrl+F is pressed again: focus the field
  onClose: () => void;
}

export function FindBar({ view, initial, caseSensitive: startCase = false, focusKey, onClose }: Props) {
  const [query, setQuery] = useState(initial);
  const [caseSensitive, setCaseSensitive] = useState(startCase);
  const [replacing, setReplacing] = useState(false);
  const [replacement, setReplacement] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const state = findKey.getState(view.state);
  const count = state?.matches.length ?? 0;

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusKey]);
  // Search as the text or the case setting change.
  useEffect(() => {
    view.dispatch(search(view.state, query, caseSensitive));
  }, [view, query, caseSensitive]);
  // Closing clears the highlights, and leaves the cursor at the match.
  useEffect(() => () => view.dispatch(closeFind(view.state)), [view]);

  const go = (step: 1 | -1) => view.dispatch(move(view.state, step));
  const close = () => {
    onClose();
    view.focus();
  };
  const doReplace = (all: boolean) => {
    const tr = replace(view.state, replacement, all);
    if (tr) view.dispatch(tr);
    if (!all) go(1);
  };

  return (
    <div className="find-bar" role="search" aria-label="Find in page">
      <div className="find-row">
        <input
          ref={input}
          aria-label="Find"
          placeholder="Find in page"
          value={query}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') go(e.shiftKey ? -1 : 1);
            else if (e.key === 'Escape') close();
            else return;
            e.preventDefault();
          }}
        />
        <span className="find-count" aria-live="polite">
          {query ? (count ? `${(state?.current ?? 0) + 1} of ${count}` : 'No matches') : ''}
        </span>
        <button type="button" className="tb" title="Previous match (Shift+Enter)" aria-label="Previous match" disabled={!count} onClick={() => go(-1)}>
          ↑
        </button>
        <button type="button" className="tb" title="Next match (Enter)" aria-label="Next match" disabled={!count} onClick={() => go(1)}>
          ↓
        </button>
        <button type="button" className={`tb${caseSensitive ? ' active' : ''}`} aria-pressed={caseSensitive} title="Match upper and lower case" onClick={() => setCaseSensitive(!caseSensitive)}>
          Aa
        </button>
        <button type="button" className={`tb wide${replacing ? ' active' : ''}`} aria-pressed={replacing} onClick={() => setReplacing(!replacing)}>
          Replace…
        </button>
        <span className="spacer" />
        <button type="button" className="tb" aria-label="Close" title="Close (Escape)" onClick={close}>
          ×
        </button>
      </div>
      {replacing && (
        <div className="find-row">
          <input
            aria-label="Replace with"
            placeholder="Replace with"
            value={replacement}
            spellCheck={false}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') doReplace(false);
              else if (e.key === 'Escape') close();
              else return;
              e.preventDefault();
            }}
          />
          <button type="button" className="tb wide" disabled={!count} onClick={() => doReplace(false)}>
            Replace
          </button>
          <button type="button" className="tb wide" disabled={!count} onClick={() => doReplace(true)}>
            Replace all
          </button>
        </div>
      )}
    </div>
  );
}
