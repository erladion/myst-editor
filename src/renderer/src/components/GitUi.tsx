// Git in the UI: the status chip, the changes panel, cloning and git's questions.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { GitChange, GitInfo } from '../../../shared/git';

const api = window.myst;

// Electron prefixes errors from the main process; keep just the message.
const message = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

export function GitChip({ info, onOpen }: { info: GitInfo | null; onOpen: () => void }) {
  if (!info?.repoRoot || !info.status) return null;
  const { branch, ahead, behind, changes } = info.status;
  const parts = [branch ?? 'detached', changes.length ? `${changes.length} change${changes.length === 1 ? '' : 's'}` : 'no changes'];
  return (
    <button type="button" className={`chip-button${changes.length ? ' has-changes' : ''}`} onClick={onOpen} title="Changes and version history (git)">
      <span aria-hidden="true">⎇</span> {parts.join(' · ')}
      {ahead > 0 && <span title={`${ahead} commit${ahead === 1 ? '' : 's'} not pushed yet`}> ↑{ahead}</span>}
      {behind > 0 && <span title={`${behind} new commit${behind === 1 ? '' : 's'} on the server`}> ↓{behind}</span>}
    </button>
  );
}

const KIND_LABEL: Record<GitChange['kind'], string> = { modified: 'Changed', added: 'New', deleted: 'Deleted', renamed: 'Renamed', conflict: 'Conflict' };

interface PanelProps {
  info: GitInfo;
  titles: Record<string, string>; // page titles by path relative to the opened folder
  saveAll: () => Promise<boolean>;
  onClose: () => void;
}

export function GitPanel({ info, titles, saveAll, onClose }: PanelProps) {
  const status = info.status!;
  const [selected, setSelected] = useState<Set<string>>(() => new Set(status.changes.map((c) => c.path)));
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Commit waiting for the writer to say who they are (true = and push).
  const [pending, setPending] = useState<boolean | null>(null);

  // New changes appear selected; ones that went away drop out.
  const paths = status.changes.map((c) => c.path).join('\0');
  useEffect(() => {
    setSelected((prev) => new Set(status.changes.filter((c) => prev.has(c.path) || !prev.size).map((c) => c.path)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths]);

  const shown = (path: string) => (info.prefix && path.startsWith(info.prefix + '/') ? path.slice(info.prefix.length + 1) : path);
  const act = async (label: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(label);
    setError(null);
    setDone(null);
    try {
      await fn();
      setDone(success);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  };
  const commit = (push: boolean) => {
    if (!info.identity) return setPending(push);
    return act(
      push ? 'Committing and pushing…' : 'Committing…',
      async () => {
        if (!(await saveAll())) throw new Error('Some pages couldn’t be saved. Fix them before committing.');
        await api.gitCommit([...selected], text, push);
        setText('');
      },
      push ? 'Committed and pushed.' : 'Committed. Push when you’re ready to share it.',
    );
  };
  useEffect(() => {
    if (info.identity && pending !== null) {
      setPending(null);
      void commit(pending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info.identity, pending]);

  if (pending !== null && !info.identity) return <IdentityForm onClose={() => setPending(null)} />;

  return (
    <Modal label="Changes" onClose={onClose}>
      <h2>Changes</h2>
      <p className="modal-help">
        On <strong>{status.branch ?? 'no branch'}</strong>
        {status.upstream ? ` (tracking ${status.upstream})` : ' (not on the server yet)'}
        {status.ahead > 0 && ` · ${status.ahead} commit${status.ahead === 1 ? '' : 's'} to push`}
        {status.behind > 0 && ` · ${status.behind} new on the server`}.
        {info.identity && ` Committing as ${info.identity.name} <${info.identity.email}>.`}
      </p>
      {status.changes.length ? (
        <ul className="git-changes" aria-label="Changed files">
          {status.changes.map((c) => {
            const rel = shown(c.path);
            return (
              <li key={c.path}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={selected.has(c.path)}
                    onChange={(e) =>
                      setSelected((s) => {
                        const next = new Set(s);
                        if (e.target.checked) next.add(c.path);
                        else next.delete(c.path);
                        return next;
                      })
                    }
                  />
                  <span className={`git-kind ${c.kind}`}>{KIND_LABEL[c.kind]}</span>
                  <span className="git-path">{titles[rel] ? `${titles[rel]} — ${rel}` : rel}</span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">No changes since the last commit.</p>
      )}
      {status.changes.length > 0 && (
        <div className="field">
          <label htmlFor="commit-message">What did you change?</label>
          <textarea id="commit-message" rows={3} value={text} placeholder="Explain installation on RHEL 9" onChange={(e) => setText(e.target.value)} />
        </div>
      )}
      {busy && <p className="muted" role="status">{busy}</p>}
      {error && <p className="sphinx-error" role="alert">{error}</p>}
      {done && <p className="git-done" role="status">{done}</p>}
      <div className="modal-actions">
        <button type="button" disabled={!!busy} onClick={() => act('Getting the latest version…', () => api.gitPull(), 'Up to date with the server.')}>
          Get latest
        </button>
        <span className="spacer" />
        {status.changes.length === 0 && status.ahead > 0 && (
          <button type="button" className="primary" disabled={!!busy} onClick={() => act('Pushing…', () => api.gitPush(), 'Pushed.')}>
            Push {status.ahead} commit{status.ahead === 1 ? '' : 's'}
          </button>
        )}
        {status.changes.length > 0 && (
          <>
            <button type="button" disabled={!!busy || !selected.size || !text.trim()} onClick={() => void commit(false)}>
              Commit
            </button>
            <button type="button" className="primary" disabled={!!busy || !selected.size || !text.trim()} onClick={() => void commit(true)}>
              Commit and push
            </button>
          </>
        )}
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}

function IdentityForm({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [global, setGlobal] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.gitSetIdentity(name.trim(), email.trim(), global);
    } catch (err) {
      setError(message(err));
    }
  };
  return (
    <Modal label="Who is committing" onClose={onClose}>
      <h2>Who is committing?</h2>
      <p className="modal-help">Commits record a name and an email address. Git doesn’t know yours yet.</p>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="git-name">Name</label>
          <input id="git-name" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="git-email">Email</label>
          <input id="git-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <label className="check">
          <input type="checkbox" checked={global} onChange={(e) => setGlobal(e.target.checked)} />
          Use for all repositories on this computer
        </label>
        {error && <p className="sphinx-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!name.trim() || !/@/.test(email)}>
            Continue
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function CloneDialog({ onCloned, onClose }: { onCloned: (folder: string) => void; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [parent, setParent] = useState('');
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api.defaultCloneFolder().then((d) => setParent((p) => p || d));
    return api.onGitProgress(setProgress);
  }, []);
  const name = useMemo(() => url.trim().replace(/\/+$/, '').split(/[/:]/).pop()?.replace(/\.git$/, '') ?? '', [url]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onCloned(await api.gitClone(url.trim(), parent));
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal label="Clone a repository" onClose={() => !busy && onClose()}>
      <h2>Get documentation from a repository</h2>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="clone-url">Repository link</label>
          <input id="clone-url" value={url} autoFocus spellCheck={false} placeholder="https://git.example.com/team/docs.git or git@host:team/docs.git" onChange={(e) => setUrl(e.target.value)} />
          <small>Any git server: HTTPS or SSH. You’ll be asked to sign in if needed.</small>
        </div>
        <div className="field">
          <label htmlFor="clone-parent">Save in</label>
          <div className="row">
            <input id="clone-parent" value={parent} onChange={(e) => setParent(e.target.value)} />
            <button type="button" onClick={async () => setParent((await api.chooseFolder('Where to put the repository')) ?? parent)}>
              Choose…
            </button>
          </div>
          {name && parent && <small>As {parent.replace(/\/$/, '')}/{name}</small>}
        </div>
        {busy && <p className="muted" role="status">{progress ?? 'Contacting the server…'}</p>}
        {error && <p className="sphinx-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || !url.trim() || !parent}>
            {busy ? 'Getting…' : 'Get repository'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Answers for git and ssh: passwords, passphrases, and "continue connecting?".
export function AskPassHost() {
  const [queue, setQueue] = useState<{ id: number; question: string }[]>([]);
  const [value, setValue] = useState('');
  useEffect(() => api.onAskPass((q) => setQueue((list) => [...list, q])), []);
  const current = queue[0];
  if (!current) return null;
  const answer = (a: string | null) => {
    api.answerAskPass(current.id, a);
    setValue('');
    setQueue((list) => list.slice(1));
  };
  const yesNo = /\(yes\/no/i.test(current.question);
  const secret = !/username/i.test(current.question);
  return (
    <Modal label="Git needs your answer" onClose={() => answer(null)}>
      <h2>{yesNo ? 'Trust this server?' : 'Sign in'}</h2>
      <pre className="askpass-question">{current.question.trim()}</pre>
      {yesNo ? (
        <div className="modal-actions">
          <button type="button" onClick={() => answer('no')}>
            No
          </button>
          <button type="button" className="primary" onClick={() => answer('yes')}>
            Yes, continue
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            answer(value);
          }}
        >
          <input aria-label="Answer" type={secret ? 'password' : 'text'} value={value} autoFocus onChange={(e) => setValue(e.target.value)} />
          <div className="modal-actions">
            <button type="button" onClick={() => answer(null)}>
              Cancel
            </button>
            <button type="submit" className="primary">
              OK
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
