// Adding a page: its title, where it goes, and which table of contents lists it.
import { useEffect, useState, type FormEvent } from 'react';
import { pageSlug } from '../pages';
import { pageFormat, pageStem } from '../../../core/format';

export interface NewPage {
  title: string;
  path: string; // relative to the opened folder
  contents: string | null; // the page whose table of contents gets it
}

interface Props {
  folders: string[]; // relative to the opened folder; '' is the folder itself
  folder: string; // the default
  files: Set<string>;
  titles: Record<string, string>;
  contentsPages: Promise<string[]>; // pages with a table of contents
  contentsDefault: (folder: string, pages: string[]) => string | null;
  extension: (folder: string) => string; // of new pages there, e.g. ".md"
  onCreate: (page: NewPage) => Promise<void>;
  onClose: () => void;
}

export function NewPageDialog({ folders, folder: initialFolder, files, titles, contentsPages, contentsDefault, extension, onCreate, onClose }: Props) {
  const [title, setTitle] = useState('');
  const [folder, setFolder] = useState(initialFolder);
  const [name, setName] = useState(''); // empty: from the title
  const [pages, setPages] = useState<string[] | null>(null);
  const [contents, setContents] = useState<string | null | undefined>(undefined); // undefined: the default
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void contentsPages.then(setPages);
  }, [contentsPages]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const ext = extension(folder);
  const file = `${pageStem(name.trim() || pageSlug(title))}${ext}`;
  const path = folder ? `${folder}/${file}` : file;
  const taken = files.has(path);
  const listedIn = contents === undefined ? (pages ? contentsDefault(folder, pages) : null) : contents;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onCreate({ title: title.trim(), path, contents: listedIn });
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="New page">
        <h2>New page</h2>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="page-title">Title</label>
            <input id="page-title" value={title} autoFocus placeholder="Installing on RHEL 9" onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="page-folder">Folder</label>
            <select id="page-folder" value={folder} onChange={(e) => setFolder(e.target.value)}>
              {folders.map((f) => (
                <option key={f} value={f}>
                  {f || '(top folder)'}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="page-file">File name</label>
            <input id="page-file" value={name} placeholder={pageSlug(title || 'new page')} spellCheck={false} onChange={(e) => setName(e.target.value)} />
            <small>
              Saved as {path}
              {taken && ' — a page with that name exists already'}
            </small>
          </div>
          <div className="field">
            <label htmlFor="page-contents">Add to the table of contents of</label>
            <select id="page-contents" value={listedIn ?? ''} disabled={!pages} onChange={(e) => setContents(e.target.value || null)}>
              <option value="">Nowhere for now</option>
              {(pages ?? []).map((p) => (
                <option key={p} value={p}>
                  {titles[p] ? `${titles[p]} — ${p}` : p}
                </option>
              ))}
            </select>
            <small>{listedIn ? 'It’s added at the end; move it in the Markdown view if needed.' : 'Readers can only reach a page that’s in a table of contents.'}</small>
          </div>
          {error && (
            <p className="sphinx-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy || !title.trim() || taken}>
              Create page
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export interface PageRename {
  title: string;
  path: string;
}

interface RenameProps {
  path: string;
  title: string;
  folders: string[]; // where it can go: folders of its own project
  files: Set<string>;
  onRename: (change: PageRename) => Promise<void>;
  onClose: () => void;
}

// Renaming a page (its title, its file) or moving it to another folder. Links and
// tables of contents pointing to it are updated.
export function RenamePageDialog({ path, title: initialTitle, folders, files, onRename, onClose }: RenameProps) {
  const slash = path.lastIndexOf('/');
  const [title, setTitle] = useState(initialTitle);
  const [folder, setFolder] = useState(slash < 0 ? '' : path.slice(0, slash));
  const ext = pageFormat(path)?.extension ?? '';
  const [name, setName] = useState(pageStem(path.slice(slash + 1)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = `${pageStem(name.trim() || 'page')}${ext}`;
  const target = folder ? `${folder}/${file}` : file;
  const taken = target !== path && files.has(target);
  const unchanged = target === path && title.trim() === initialTitle;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onRename({ title: title.trim(), path: target });
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Rename page">
        <h2>Rename or move page</h2>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="rename-title">Title</label>
            <input id="rename-title" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} />
            <small>The page’s heading, shown in the contents.</small>
          </div>
          <div className="field">
            <label htmlFor="rename-folder">Folder</label>
            <select id="rename-folder" value={folder} onChange={(e) => setFolder(e.target.value)}>
              {folders.map((f) => (
                <option key={f} value={f}>
                  {f || '(top folder)'}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rename-file">File name</label>
            <div className="row">
              <input id="rename-file" value={name} spellCheck={false} onChange={(e) => setName(e.target.value)} />
              <button type="button" title="A file name made from the title" onClick={() => setName(pageSlug(title))}>
                From the title
              </button>
            </div>
            <small>
              {target === path ? `Stays ${path}` : `Becomes ${target}`}
              {taken && ' — there’s a page with that name already'}
            </small>
          </div>
          {target !== path && <p className="muted">Tables of contents and links pointing to it are updated, and so are the page’s own links and pictures if it changes folder.</p>}
          {error && (
            <p className="sphinx-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy || (!title.trim() && !!initialTitle) || taken || unchanged}>
              {busy ? 'Renaming…' : 'Rename'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
