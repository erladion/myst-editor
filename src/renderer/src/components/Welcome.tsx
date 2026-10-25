// Before a folder is open: open one, clone one, or pick a recent one. And while one
// opens (which takes a while for a large folder), what's happening.
import type { ReactNode } from 'react';
import type { OpenProgress } from '../../../shared/api';

export function OpeningCard({ opening }: { opening: OpenProgress | null }) {
  if (!opening) return null;
  return (
    <div className="opening" role="status" aria-live="polite">
      <div className="welcome-card">
        <div className="spinner large" aria-hidden="true" />
        <h2>Opening {opening.folder.split(/[\\/]/).pop()}</h2>
        <p>
          {opening.step}…{opening.detail && <span className="muted"> {opening.detail}</span>}
        </p>
      </div>
    </div>
  );
}

interface Props {
  opening: OpenProgress | null;
  starting: boolean; // the last session's folder may still be opening
  recentFolders: string[];
  onChoose: () => void;
  onClone: () => void;
  onNewProject: () => void;
  onOpenRecent: (folder: string) => void;
  children?: ReactNode; // dialogs
}

export function Welcome({ opening, starting, recentFolders, onChoose, onClone, onNewProject, onOpenRecent, children }: Props) {
  return (
    <div className="welcome">
      <OpeningCard opening={opening} />
      {!starting && !opening && (
        <div className="welcome-card">
          <h1>MyST Editor</h1>
          <p>Edit your Sphinx documentation as formatted pages. Your Markdown files are saved exactly as written, apart from what you change.</p>
          <button type="button" className="primary large" onClick={onChoose}>
            Open documentation folder
          </button>
          <button type="button" className="large secondary" onClick={onClone}>
            Get from a repository…
          </button>
          <button type="button" className="large secondary" onClick={onNewProject}>
            New project…
          </button>
          {recentFolders.length > 0 && (
            <section className="recent-folders" aria-label="Recent folders">
              <h2>Recent</h2>
              <ul>
                {recentFolders.map((folder) => (
                  <li key={folder}>
                    <button type="button" className="link-button" title={folder} onClick={() => onOpenRecent(folder)}>
                      <span className="recent-name">{folder.split(/[\\/]/).filter(Boolean).pop()}</span>
                      <span className="recent-path">{folder}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
