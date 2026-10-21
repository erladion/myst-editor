// Git in the UI: the status chip, the changes panel, cloning and git's questions.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Branches, ConflictFile, GitChange, GitInfo, GitOperation } from '../../../shared/git';
import { conflictCount, parseConflicts, resolveConflicts, type Choice } from '../../../core/conflicts';
import { Changes } from './History';

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

export function GitChip({ info, onOpen, onBranches }: { info: GitInfo | null; onOpen: () => void; onBranches: () => void }) {
  if (!info?.repoRoot || !info.status) return null;
  const { branch, ahead, behind, changes } = info.status;
  if (info.operation) {
    return (
      <button type="button" className="chip-button failed" onClick={onOpen} title="Getting the latest stopped where your changes and the server’s clash">
        <span aria-hidden="true">⎇</span> Finish getting the latest…
      </button>
    );
  }
  const summary = changes.length ? `${changes.length} change${changes.length === 1 ? '' : 's'}` : 'no changes';
  const checked = info.checked
    ? info.checked.error
      ? `Couldn’t check the server: ${info.checked.error}`
      : `Server checked at ${new Date(info.checked.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
    : 'The server hasn’t been checked yet';
  return (
    <span className="git-chip">
      <button type="button" className="chip-button git-branch" onClick={onBranches} title="Switch branch, or start a new one (Ctrl+Shift+B)">
        <span aria-hidden="true">⎇</span> {branch ?? 'no branch'}
      </button>
      <button type="button" className={`chip-button${changes.length ? ' has-changes' : ''}${behind ? ' has-news' : ''}`} onClick={onOpen} title={`Changes, commits and the server (git). ${checked}.`}>
        {summary}
        {ahead > 0 && <span title={`${ahead} commit${ahead === 1 ? '' : 's'} not pushed yet`}> ↑{ahead}</span>}
        {behind > 0 && <span title={`${behind} new commit${behind === 1 ? '' : 's'} on the server`}> ↓{behind} new</span>}
      </button>
    </span>
  );
}

const KIND_LABEL: Record<GitChange['kind'], string> = { modified: 'Changed', added: 'New', deleted: 'Deleted', renamed: 'Renamed', conflict: 'Conflict' };

interface PanelProps {
  info: GitInfo;
  titles: Record<string, string>; // page titles by path relative to the opened folder
  saveAll: () => Promise<boolean>;
  onConflicts: () => void; // getting the latest stopped at a clash
  confirm: (opts: { title: string; message: string; confirm: string }) => Promise<boolean>;
  onClose: () => void;
}

export function GitPanel({ info, titles, saveAll, onConflicts, confirm, onClose }: PanelProps) {
  const [open, setOpen] = useState<string | null>(null); // the file whose changes are shown
  // Opening the panel is when an up-to-date "new on the server" matters most.
  useEffect(() => {
    void api.gitCheck();
  }, []);
  const getLatest = () =>
    act(
      'Getting the latest version…',
      async () => {
        if (!(await saveAll())) throw new Error('Some pages couldn’t be saved. Fix them first.');
        if (await api.gitGetLatest()) onConflicts();
      },
      'Up to date with the server.',
    );
  const discard = async (path: string, label: string) => {
    const ok = await confirm({
      title: 'Discard changes',
      message: `Throw away your changes to ${label} since the last commit? A page’s text as it is now is kept in its history, so you can get it back.`,
      confirm: 'Discard changes',
    });
    if (ok) await act('Discarding…', () => api.gitDiscard(path), `Discarded your changes to ${label}.`);
  };
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
  const inFolder = (path: string) => !info.prefix || path.startsWith(info.prefix + '/');
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
        {info.checked?.error && ` Couldn’t check the server: ${info.checked.error}`}
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
                <span className="git-file-actions">
                  {c.kind !== 'deleted' && c.kind !== 'conflict' && inFolder(c.path) && (
                    <button type="button" className="link-button" aria-expanded={open === c.path} onClick={() => setOpen(open === c.path ? null : c.path)}>
                      {open === c.path ? 'Hide changes' : 'Show changes'}
                    </button>
                  )}
                  <button type="button" className="link-button danger" disabled={!!busy} onClick={() => void discard(c.path, titles[rel] ?? rel)}>
                    Discard…
                  </button>
                </span>
                {open === c.path && <FileChanges path={c.path} rel={rel} />}
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
        <button type="button" className={status.behind ? 'primary' : undefined} disabled={!!busy} onClick={() => void getLatest()}>
          Get latest{status.behind ? ` (${status.behind} new)` : ''}
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
  const name = useMemo(() => url.trim().replace(/[\\/]+$/, '').split(/[\\/:]/).pop()?.replace(/\.git$/, '') ?? '', [url]);
  const sep = parent.includes('\\') ? '\\' : '/';
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
          {name && parent && (
            <small>
              As {parent.replace(/[\\/]$/, '')}
              {sep}
              {name}
            </small>
          )}
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

// A file's uncommitted changes: as last committed, against now.
function FileChanges({ path, rel }: { path: string; rel: string }) {
  const [texts, setTexts] = useState<{ before: string; now: string } | null>(null);
  useEffect(() => {
    void Promise.all([api.gitCommitted(path), api.readFile(rel)]).then(([before, now]) => setTexts({ before: before ?? '', now }));
  }, [path, rel]);
  if (!texts) return <p className="muted">Loading…</p>;
  return (
    <div className="git-file-changes">
      <Changes from={texts.before} to={texts.now} labels={['As last committed', 'Your changes']} />
    </div>
  );
}

// Settling what clashed when getting the latest: for each spot, keep yours, take the
// server's, or keep both; pictures and deleted files are taken whole.
export function ConflictsDialog({ info, titles, onDone, onClose }: { info: GitInfo; titles: Record<string, string>; onDone: (message: string) => void; onClose: () => void }) {
  const [files, setFiles] = useState<ConflictFile[] | null>(null);
  const [choices, setChoices] = useState<Record<string, (Choice | 'yours' | 'server' | undefined)[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    setChoices({});
    void api.gitConflicts().then(setFiles);
  };
  useEffect(load, []);
  // In a rebase (and when putting set-aside edits back) the top side is the server's.
  const topIsServer = info.operation !== 'merge';
  const yours: Choice = topIsServer ? 'bottom' : 'top';
  const server: Choice = topIsServer ? 'top' : 'bottom';
  const shown = (path: string) => (info.prefix && path.startsWith(info.prefix + '/') ? path.slice(info.prefix.length + 1) : path);
  const parsed = useMemo(() => Object.fromEntries((files ?? []).map((f) => [f.path, f.text === null ? null : parseConflicts(f.text)])), [files]);
  const spots = (f: ConflictFile) => {
    const p = parsed[f.path];
    return p ? conflictCount(p) : 1;
  };
  const choose = (path: string, i: number, c: Choice | 'yours' | 'server') => setChoices((all) => ({ ...all, [path]: Object.assign([...(all[path] ?? [])], { [i]: c }) }));
  const complete = !!files && files.every((f) => Array.from({ length: spots(f) }, (_, i) => choices[f.path]?.[i]).every(Boolean));

  const finish = async () => {
    if (!files) return;
    setBusy(true);
    setError(null);
    try {
      for (const f of files) {
        const p = parsed[f.path];
        if (p) await api.gitResolve(f.path, resolveConflicts(p, choices[f.path] as Choice[]));
        else await api.gitTakeSide(f.path, choices[f.path]![0] as 'yours' | 'server');
      }
      if (await api.gitContinue()) {
        // The next of your commits clashes too.
        load();
        setBusy(false);
        return;
      }
      onDone('Up to date with the server, with your changes on top.');
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };
  const cancel = async () => {
    setBusy(true);
    try {
      await api.gitAbort();
      onDone('Back as it was before getting the latest.');
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };

  return (
    <Modal label="Settle what clashed" onClose={() => !busy && onClose()}>
      <h2>Your changes and the server’s clash</h2>
      <p className="modal-help">
        {info.operation === 'stash'
          ? 'The latest version is in, but some of your uncommitted edits changed the same lines. Choose what to keep in each place.'
          : 'You and a colleague changed the same lines. Choose what to keep in each place; the rest of both sets of changes is already combined.'}
      </p>
      {files === null && <p className="muted">Looking…</p>}
      <div className="conflict-files">
        {files?.map((f) => {
          const rel = shown(f.path);
          const p = parsed[f.path];
          return (
            <section key={f.path} className="conflict-file" aria-label={titles[rel] ?? rel}>
              <h3>
                {titles[rel] ?? rel} <span className="muted">{rel}</span>
              </h3>
              {p ? (
                p.parts.map((part, k) => {
                  if (part.kind === 'same') return null;
                  const i = p.parts.slice(0, k).filter((x) => x.kind === 'conflict').length;
                  const before = p.parts[k - 1]?.kind === 'same' ? (p.parts[k - 1] as { lines: string[] }).lines.slice(-2) : [];
                  const after = p.parts[k + 1]?.kind === 'same' ? (p.parts[k + 1] as { lines: string[] }).lines.slice(0, 2) : [];
                  const mine = topIsServer ? part.bottom : part.top;
                  const theirs = topIsServer ? part.top : part.bottom;
                  const picked = choices[f.path]?.[i];
                  return (
                    <div key={k} className="conflict-spot" role="group" aria-label={`Place ${i + 1}`}>
                      {before.length > 0 && <pre className="conflict-context">{before.join('\n')}</pre>}
                      <div className="conflict-sides">
                        <div className={`conflict-side${picked === yours || picked === 'both' ? ' picked' : ''}`}>
                          <div className="conflict-label">Yours</div>
                          <pre>{mine.join('\n') || '(nothing: you removed it)'}</pre>
                        </div>
                        <div className={`conflict-side${picked === server || picked === 'both' ? ' picked' : ''}`}>
                          <div className="conflict-label">From the server</div>
                          <pre>{theirs.join('\n') || '(nothing: removed there)'}</pre>
                        </div>
                      </div>
                      {after.length > 0 && <pre className="conflict-context">{after.join('\n')}</pre>}
                      <div className="conflict-choices">
                        {(
                          [
                            [yours, 'Keep yours'],
                            [server, 'Take the server’s'],
                            ['both', 'Keep both'],
                          ] as const
                        ).map(([c, label]) => (
                          <label key={label} className="check" title={c === 'both' ? (topIsServer ? 'The server’s text first, then yours' : 'Your text first, then the server’s') : undefined}>
                            <input type="radio" name={`${f.path}-${i}`} checked={picked === c} onChange={() => choose(f.path, i, c)} />
                            {label}
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="conflict-choices">
                  <span className="muted">This file can only be taken whole.</span>
                  {(
                    [
                      ['yours', 'Keep yours'],
                      ['server', 'Take the server’s'],
                    ] as const
                  ).map(([c, label]) => (
                    <label key={c} className="check">
                      <input type="radio" name={f.path} checked={choices[f.path]?.[0] === c} onChange={() => choose(f.path, 0, c)} />
                      {label}
                    </label>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
      {error && (
        <p className="sphinx-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        {info.operation !== 'stash' && (
          <button type="button" disabled={busy} onClick={() => void cancel()}>
            Cancel getting the latest
          </button>
        )}
        <span className="spacer" />
        <button type="button" onClick={onClose} disabled={busy}>
          Later
        </button>
        <button type="button" className="primary" disabled={busy || !complete} onClick={() => void finish()}>
          {busy ? 'Finishing…' : 'Done'}
        </button>
      </div>
    </Modal>
  );
}

// A branch name from what was typed: spaces become hyphens, and characters git doesn't
// allow in branch names go.
export function branchName(typed: string): string {
  return typed
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[~^:?*[\\\x00-\x1f\x7f]+/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/\/{2,}/g, '/')
    .replace(/@\{/g, '@')
    .replace(/^[-./]+|[./]+$|\.lock$/g, '');
}

interface BranchProps {
  info: GitInfo;
  saveAll: () => Promise<boolean>;
  onSwitched: (operation: GitOperation, message: string) => void;
  onClose: () => void;
}

// Switching branch, or starting a new one. Pull requests stay with the git server.
export function BranchDialog({ info, saveAll, onSwitched, onClose }: BranchProps) {
  const [branches, setBranches] = useState<Branches | null>(null);
  const [filter, setFilter] = useState('');
  const [target, setTarget] = useState<{ name: string; label: string } | null>(null); // asking about uncommitted changes
  const [leave, setLeave] = useState(true);
  const [creating, setCreating] = useState(false);
  const [typed, setTyped] = useState('');
  const [fromBase, setFromBase] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api.gitBranches().then(setBranches, (e) => setError(message(e)));
  }, []);
  const changes = info.status?.changes.length ?? 0;
  const current = branches?.current ?? info.status?.branch ?? null;
  const name = branchName(typed);
  const match = (n: string) => n.toLowerCase().includes(filter.trim().toLowerCase());

  const run = async (fn: () => Promise<GitOperation | void>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      if (!(await saveAll())) throw new Error('Some pages couldn’t be saved. Fix them first.');
      onSwitched((await fn()) ?? null, done);
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };
  const pick = (branch: string, label: string) => {
    if (label === current) return;
    if (changes) setTarget({ name: branch, label });
    else void run(() => api.gitSwitch(branch, false), `On ${label} now.`);
  };

  const row = (key: string, label: string, detail: string, onClick: () => void, isCurrent = false) => (
    <li key={key}>
      <button type="button" className={`branch-row${isCurrent ? ' current' : ''}`} aria-current={isCurrent ? 'true' : undefined} disabled={busy} onClick={onClick}>
        <span className="branch-name">{label}</span>
        <span className="branch-detail">{isCurrent ? 'you’re on this one' : detail}</span>
      </button>
    </li>
  );
  const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <Modal label="Branches" onClose={() => !busy && onClose()}>
      <h2>Branches</h2>
      {target ? (
        <>
          <p className="modal-help">
            You have {changes} uncommitted change{changes === 1 ? '' : 's'} on <strong>{current}</strong>. What should happen to {changes === 1 ? 'it' : 'them'}?
          </p>
          <label className="check">
            <input type="radio" checked={leave} onChange={() => setLeave(true)} />
            Leave {changes === 1 ? 'it' : 'them'} on {current}: set aside, and back when you return to {current}
          </label>
          <label className="check">
            <input type="radio" checked={!leave} onChange={() => setLeave(false)} />
            Take {changes === 1 ? 'it' : 'them'} along to {target.label}
          </label>
          {error && (
            <p className="sphinx-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" disabled={busy} onClick={() => setTarget(null)}>
              Back
            </button>
            <button type="button" className="primary" disabled={busy} onClick={() => void run(() => api.gitSwitch(target.name, leave), `On ${target.label} now.`)}>
              {busy ? 'Switching…' : `Switch to ${target.label}`}
            </button>
          </div>
        </>
      ) : creating ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name) void run(() => api.gitCreateBranch(name, fromBase ? branches?.base ?? null : null), `On the new branch ${name}. It goes to the server with your first push.`);
          }}
        >
          <div className="field">
            <label htmlFor="branch-name">Name</label>
            <input id="branch-name" value={typed} autoFocus spellCheck={false} placeholder="feature/install-guide" onChange={(e) => setTyped(e.target.value)} />
            {typed && name !== typed.trim() && <small>As {name || '(nothing usable)'}</small>}
          </div>
          {branches?.base && (
            <>
              <label className="check">
                <input type="radio" checked={fromBase} onChange={() => setFromBase(true)} />
                Start from the latest {branches.base.replace(/^[^/]+\//, '')} on the server
              </label>
              <label className="check">
                <input type="radio" checked={!fromBase} onChange={() => setFromBase(false)} />
                Start from what you have now ({current})
              </label>
            </>
          )}
          {changes > 0 && <p className="muted">Your uncommitted changes come along to the new branch.</p>}
          {error && (
            <p className="sphinx-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" disabled={busy} onClick={() => setCreating(false)}>
              Back
            </button>
            <button type="submit" className="primary" disabled={busy || !name}>
              {busy ? 'Creating…' : 'Create branch'}
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="row branch-search">
            <input aria-label="Find a branch" placeholder="Find a branch" value={filter} autoFocus onChange={(e) => setFilter(e.target.value)} />
            <button type="button" onClick={() => setCreating(true)}>
              New branch…
            </button>
          </div>
          {!branches && !error && <p className="muted">Looking…</p>}
          {branches && (
            <div className="branch-lists">
              <h3>Yours</h3>
              <ul aria-label="Your branches">
                {branches.local
                  .filter((b) => match(b.name))
                  .map((b) =>
                    row(
                      b.name,
                      b.name,
                      [b.gone ? 'gone from the server' : b.upstream ? null : 'not on the server yet', b.ahead ? `↑${b.ahead}` : null, b.behind ? `↓${b.behind}` : null, when(b.date)].filter(Boolean).join(' · '),
                      () => pick(b.name, b.name),
                      b.name === current,
                    ),
                  )}
              </ul>
              {branches.remote.some((b) => match(b.branch)) && (
                <>
                  <h3>On the server</h3>
                  <ul aria-label="Branches on the server">
                    {branches.remote.filter((b) => match(b.branch)).map((b) => row(b.name, b.branch, when(b.date), () => pick(b.name, b.branch)))}
                  </ul>
                </>
              )}
            </div>
          )}
          {error && (
            <p className="sphinx-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
