// File → New Project: its title, what it's written in, where it goes, and whether
// it's a git repository.
import { useEffect, useState, type FormEvent } from 'react';
import { pageSlug } from '../pages';

const api = window.myst;

export function NewProjectDialog({ onCreated, onClose }: { onCreated: (folder: string, note: string | null) => void; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [folder, setFolder] = useState(''); // empty: from the title
  const [parent, setParent] = useState('');
  const [useGit, setUseGit] = useState(true);
  const [kind, setKind] = useState<'sphinx' | 'asciidoctor' | 'antora'>('sphinx');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api.defaultCloneFolder().then((d) => setParent((p) => p || d));
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const name = folder.trim() || pageSlug(title) || 'documentation';
  const sep = parent.includes('\\') ? '\\' : '/';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await api.createProject({ title: title.trim(), parent, folder: name, git: useGit, builder: kind === 'sphinx' ? 'sphinx' : 'asciidoctor', antora: kind === 'antora' });
    setBusy(false);
    if (result.ok) onCreated(result.path, result.note);
    else setError(result.message);
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="New project">
        <h2>New documentation project</h2>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="project-title">Title</label>
            <input id="project-title" value={title} autoFocus placeholder="Product manual" onChange={(e) => setTitle(e.target.value)} />
          </div>
          <fieldset className="field">
            <legend>Written in</legend>
            <label className="check">
              <input type="radio" name="project-builder" checked={kind === 'sphinx'} onChange={() => setKind('sphinx')} />
              MyST Markdown, built with Sphinx
            </label>
            <label className="check">
              <input type="radio" name="project-builder" checked={kind === 'asciidoctor'} onChange={() => setKind('asciidoctor')} />
              AsciiDoc, built with Asciidoctor
            </label>
            <label className="check">
              <input type="radio" name="project-builder" checked={kind === 'antora'} onChange={() => setKind('antora')} />
              AsciiDoc, an Antora component
            </label>
          </fieldset>
          <div className="field">
            <label htmlFor="project-parent">Save in</label>
            <div className="row">
              <input id="project-parent" value={parent} onChange={(e) => setParent(e.target.value)} />
              <button type="button" onClick={async () => setParent((await api.chooseFolder('Where to put the project')) ?? parent)}>
                Choose…
              </button>
            </div>
          </div>
          <div className="field">
            <label htmlFor="project-folder">Folder name</label>
            <input id="project-folder" value={folder} placeholder={name} spellCheck={false} onChange={(e) => setFolder(e.target.value)} />
            {parent && (
              <small>
                As {parent.replace(/[\\/]$/, '')}
                {sep}
                {name}, with the pages in its docs folder
              </small>
            )}
          </div>
          <div className="field">
            <label className="check">
              <input type="checkbox" checked={useGit} onChange={(e) => setUseGit(e.target.checked)} />
              Make it a git repository
            </label>
            <small>So its history is kept, and it can be shared through a git server later.</small>
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
            <button type="submit" className="primary" disabled={busy || !title.trim() || !parent}>
              Create project
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
