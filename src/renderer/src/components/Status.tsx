// Save status: the status bar line and the banner for problems that need a decision.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Node as PMNode } from 'prosemirror-model';
import type { PageConfig } from '../../../core/format';
import { editingFor } from '../formats/editing';
import type { Session } from '../workspace';

interface StatusProps {
  session: Session | undefined;
  config: PageConfig;
  marker: string | null;
  children?: ReactNode; // build status
}

const countWords = (doc: PMNode | undefined) => (doc ? doc.textBetween(0, doc.content.size, ' ', ' ').split(/\s+/).filter(Boolean).length : 0);

// Counting a long page's words on every keystroke slows typing down: they're counted
// when typing pauses (and straight away for another page).
function useWordCount(path: string | undefined, doc: PMNode | undefined) {
  const [words, setWords] = useState(() => countWords(doc));
  const counted = useRef(path);
  useEffect(() => {
    if (counted.current !== path) {
      counted.current = path;
      setWords(countWords(doc));
      return;
    }
    const timer = setTimeout(() => setWords(countWords(doc)), 300);
    return () => clearTimeout(timer);
  }, [path, doc]);
  return words;
}

export function StatusBar({ session, config, marker, children }: StatusProps) {
  const words = useWordCount(session?.path, session?.state.doc);
  const status = session?.status;
  const label =
    !status ? '' :
    status.kind === 'saved' ? 'All changes saved' :
    status.kind === 'pending' ? 'Editing…' :
    status.kind === 'saving' ? 'Saving…' :
    status.kind === 'unsafe' ? 'Not saved' :
    status.kind === 'conflict' ? 'Changed on disk' :
    'Save failed';
  const dialect = editingFor(config).dialect(config, marker);
  return (
    <footer className="statusbar">
      <span className={`save-status ${status?.kind ?? ''}`} role="status" aria-live="polite">
        {label}
      </span>
      {session && <span className="muted">{session.path}</span>}
      <span className="spacer" />
      {children}
      {session && <span className="muted">{words.toLocaleString()} words</span>}
      <span className="muted dialect" title={dialect.detail}>
        {dialect.label}
      </span>
    </footer>
  );
}

interface BannerProps {
  session: Session;
  onSaveAnyway: () => void;
  onShowSource: () => void;
  onReload: () => void;
  onKeepMine: () => void;
  onRetry: () => void;
}

export function Banner({ session, onSaveAnyway, onShowSource, onReload, onKeepMine, onRetry }: BannerProps) {
  const { status } = session;
  if (status.kind === 'unsafe') {
    return (
      <div className="banner warning" role="alert">
        <div>
          <strong>This change can’t be saved safely.</strong> Saving it would change the page in a way you didn’t make
          ({status.problem}). Undo the last change, or check the Markdown source.
        </div>
        <div className="banner-actions">
          <button type="button" onClick={onShowSource}>
            Show Markdown
          </button>
          <button type="button" onClick={onSaveAnyway}>
            Save anyway
          </button>
        </div>
      </div>
    );
  }
  if (status.kind === 'conflict') {
    return (
      <div className="banner warning" role="alert">
        <div>
          <strong>This page was changed outside the editor</strong> while you had unsaved changes.
        </div>
        <div className="banner-actions">
          <button type="button" onClick={onReload}>
            Use the version on disk
          </button>
          <button type="button" onClick={onKeepMine}>
            Keep my version
          </button>
        </div>
      </div>
    );
  }
  if (status.kind === 'error') {
    return (
      <div className="banner error" role="alert">
        <div>
          <strong>Couldn’t save this page:</strong> {status.message}
        </div>
        <div className="banner-actions">
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  return null;
}
