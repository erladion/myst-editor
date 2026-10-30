// Sphinx in the UI: the permission banner, the status chip, the problems list and
// the preview pane.
import { useEffect, useMemo, useRef, useState } from 'react';
import { usable, type EnvironmentChoice, type PythonCandidate } from '../../../shared/sphinx';
import { type BuildState, type BuildWarning } from '../../../shared/build';
import { usePanelHeight } from './PanelResize';
import { PRODUCT } from '../../../shared/product';

interface TrustProps {
  state: BuildState;
  onUse: (choice: EnvironmentChoice) => void;
  onChooseOther: () => void;
  onDecline: () => void;
}

const describe = (c: PythonCandidate) => `Sphinx ${c.sphinx}, Python ${c.pythonVersion}`;

export function TrustBanner({ state, onUse, onChooseOther, onDecline }: TrustProps) {
  if (state.status.kind !== 'needs-trust') return null;
  const { requirements, candidates } = state.status;
  const best = candidates.find(usable);
  return (
    <div className="banner info" role="region" aria-label="Preview">
      <div>
        <strong>Check links and preview pages with Sphinx?</strong> Builds run the project’s <code>conf.py</code>, so
        only allow this for projects you trust.{' '}
        {best ? (
          <>
            Found <strong>{best.label}</strong> on this computer ({describe(best)}).
          </>
        ) : (
          <>The packages from {requirements} are downloaded into a private environment (needs internet the first time).</>
        )}
      </div>
      <div className="banner-actions">
        <button type="button" onClick={onDecline}>
          Not now
        </button>
        <button type="button" onClick={onChooseOther}>
          {best ? 'Other…' : 'Use Python on this computer…'}
        </button>
        {best && (
          <button type="button" onClick={() => onUse({ kind: 'managed' })}>
            Download packages
          </button>
        )}
        <button
          type="button"
          className="primary"
          onClick={() => onUse(best ? { kind: 'existing', python: best.python } : { kind: 'managed' })}
        >
          {best ? `Use ${best.label}` : 'Allow'}
        </button>
      </div>
    </div>
  );
}

interface EnvironmentDialogProps {
  state: BuildState;
  projects: number; // how many projects the choice applies to
  onUse: (choice: EnvironmentChoice) => void;
  onClose: () => void;
}

// Choose where builds get Python from: a private uv environment, or one already here.
export function EnvironmentDialog({ state, projects, onUse, onClose }: EnvironmentDialogProps) {
  const [candidates, setCandidates] = useState<PythonCandidate[] | null>(null);
  const current = state.environment;
  const [selected, setSelected] = useState<string>(current?.kind === 'existing' ? current.python : 'managed');
  const offline = state.status.kind === 'error' && !!state.status.offline;
  useEffect(() => {
    void window.myst.pythonCandidates().then((found) => {
      setCandidates(found);
      // The private environment just failed for lack of internet: suggest a local one.
      const local = found.find(usable);
      if (offline && local) setSelected((s) => (s === 'managed' ? local.python : s));
    });
  }, [offline]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const browse = async () => {
    const found = await window.myst.browsePython();
    if (!found) return;
    setCandidates((list) => [...(list ?? []).filter((c) => c.python !== found.python), found]);
    if (usable(found)) setSelected(found.python);
  };
  const requirements = current?.kind === 'managed' ? current.requirements : state.status.kind === 'needs-trust' ? state.status.requirements : 'the project’s requirements';

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Python environment">
        <h2>Python environment for {projects > 1 ? `the ${projects} projects in this folder` : 'this project'}</h2>
        <p className="modal-help">
          Sphinx builds run with this Python. It needs Sphinx, MyST-Parser and the extensions {projects > 1 ? 'each' : 'the'} project’s conf.py uses.
        </p>
        <div className="env-options" role="radiogroup" aria-label="Python environment">
          <label className="env-option">
            <input type="radio" name="env" checked={selected === 'managed'} onChange={() => setSelected('managed')} />
            <span>
              <strong>Private environment</strong>
              <small>
                Set up by {PRODUCT.name}: downloads Python and the packages from {requirements}. Needs internet the first time
                {offline ? ', which this computer doesn’t have' : ''}.
              </small>
            </span>
          </label>
          {candidates === null && <p className="muted">Looking for Python on this computer…</p>}
          {candidates?.map((c) => (
            <label key={c.python} className={`env-option${usable(c) ? '' : ' unusable'}`}>
              <input type="radio" name="env" disabled={!usable(c)} checked={selected === c.python} onChange={() => setSelected(c.python)} />
              <span>
                <strong>{c.label}</strong>
                <code>{c.python}</code>
                <small>
                  Python {c.pythonVersion} ·{' '}
                  {usable(c)
                    ? `Sphinx ${c.sphinx}, MyST-Parser ${c.myst}`
                    : `missing ${[!c.sphinx && 'Sphinx', !c.myst && 'MyST-Parser'].filter(Boolean).join(' and ')}`}
                </small>
              </span>
            </label>
          ))}
          {candidates?.length === 0 && <p className="muted">No other Python found.</p>}
        </div>
        <button type="button" className="link-button" onClick={() => void browse()}>
          Browse for a Python…
        </button>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => onUse(selected === 'managed' ? { kind: 'managed' } : { kind: 'existing', python: selected })}
          >
            Use this environment
          </button>
        </div>
      </div>
    </div>
  );
}

interface SphinxDialogProps {
  state: BuildState;
  project?: string; // named when the folder has several projects
  projectId: string | null;
  onChangeEnvironment: () => void;
  onRebuild: () => void;
  onShowLog: () => void;
  onClose: () => void;
}

// Build status and the environment in use, from the status bar.
export function SphinxDialog({ state, project, projectId, onChangeEnvironment, onRebuild, onShowLog, onClose }: SphinxDialogProps) {
  const { status, info, environment } = state;
  const [editingEnv, setEditingEnv] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const statusText =
    status.kind === 'building' ? 'Building…' :
    status.kind === 'setting-up' ? `${status.step}…` :
    status.kind === 'ready' && info ? `Built in ${info.duration.toFixed(1)} s with ${info.builtWith.name} ${info.builtWith.version}` :
    status.kind === 'declined' ? 'Off for this session' :
    status.kind === 'error' ? 'Failed' : '';
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Sphinx">
        <h2>Sphinx{project ? ` — ${project}` : ''}</h2>
        {status.kind === 'error' && <p className={`sphinx-error${status.offline ? ' offline' : ''}`}>{status.message}</p>}
        <dl className="facts">
          <dt>Status</dt>
          <dd>{statusText}</dd>
          <dt>Python</dt>
          <dd>
            {environment?.kind === 'existing' ? (
              <>
                <code>{environment.python}</code> (Python {environment.pythonVersion}, Sphinx {environment.sphinx})
              </>
            ) : environment?.kind === 'managed' ? (
              <>Private environment, from {environment.requirements}</>
            ) : (
              'Not chosen yet'
            )}
          </dd>
        </dl>
        {projectId && <EnvVars projectId={projectId} editing={editingEnv} onEditing={setEditingEnv} />}
        {!editingEnv && (
          <div className="modal-actions">
            <button type="button" onClick={onShowLog}>
              Build log
            </button>
            <button type="button" onClick={onRebuild} disabled={!environment || status.kind === 'error'}>
              Rebuild everything
            </button>
            <button type="button" className={status.kind === 'error' ? 'primary' : ''} onClick={onChangeEnvironment}>
              Change Python environment…
            </button>
            <button type="button" className={status.kind === 'error' ? '' : 'primary'} onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Environment variables the build gets: the project's (from .wysie.toml, shared
// with everyone) and the writer's own (kept in the app, for this folder), which win.
function EnvVars({ projectId, editing, onEditing }: { projectId: string; editing: boolean; onEditing: (e: boolean) => void }) {
  const [vars, setVars] = useState<{ project: Record<string, string>; yours: Record<string, string> } | null>(null);
  const [rows, setRows] = useState<[string, string][]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void window.myst.sphinxEnv(projectId).then(setVars);
  }, [projectId]);
  if (!vars) return null;
  const projectOnly = Object.entries(vars.project).filter(([name]) => !(name in vars.yours));
  const all: [string, string, 'project' | 'yours'][] = [...projectOnly.map(([n, v]) => [n, v, 'project'] as [string, string, 'project']), ...Object.entries(vars.yours).map(([n, v]) => [n, v, 'yours'] as [string, string, 'yours'])];

  if (!editing) {
    return (
      <section className="env-vars" aria-label="Environment variables">
        <h3>Environment variables</h3>
        {all.length ? (
          <dl className="facts">
            {all.map(([name, value, from]) => (
              <div key={name} className="env-row">
                <dt>
                  <code>{name}</code>
                </dt>
                <dd>
                  <code>{value}</code>{' '}
                  <span className="muted">{from === 'project' ? '(from the project’s settings file)' : name in vars.project ? '(yours, instead of the project’s)' : '(yours)'}</span>
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="muted">None. Add some if the project’s conf.py reads them.</p>
        )}
        <button
          type="button"
          onClick={() => {
            setRows(Object.entries(vars.yours));
            onEditing(true);
          }}
        >
          Edit variables…
        </button>
      </section>
    );
  }

  const names = rows.map(([n]) => n.trim());
  const bad = names.find((n, i) => !ENV_NAME.test(n) || names.indexOf(n) !== i);
  const set = (i: number, at: 0 | 1, value: string) => setRows((r) => r.map((row, j) => (j === i ? ((at ? [row[0], value] : [value, row[1]]) as [string, string]) : row)));
  const save = async () => {
    setSaving(true);
    await window.myst.setSphinxEnv(Object.fromEntries(rows.map(([n, v]) => [n.trim(), v])));
    setVars(await window.myst.sphinxEnv(projectId));
    setSaving(false);
    onEditing(false);
  };
  return (
    <section className="env-vars" aria-label="Edit environment variables">
      <h3>Environment variables</h3>
      <p className="modal-help">
        Yours apply to every project in this folder and are kept by the app (not in the repository). A name the project also sets uses your value. Saving builds
        everything again.
      </p>
      {projectOnly.length > 0 && (
        <ul className="env-project">
          {projectOnly.map(([name, value]) => (
            <li key={name}>
              <code>
                {name}={value}
              </code>{' '}
              <span className="muted">from the project’s settings file</span>{' '}
              {!names.includes(name) && (
                <button type="button" className="link-button" onClick={() => setRows((r) => [...r, [name, value]])}>
                  Use another value
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {rows.map(([name, value], i) => (
        <div key={i} className="env-edit row">
          <input aria-label="Name" placeholder="NAME" value={name} spellCheck={false} onChange={(e) => set(i, 0, e.target.value)} />
          <input aria-label="Value" placeholder="value" value={value} spellCheck={false} onChange={(e) => set(i, 1, e.target.value)} />
          <button type="button" aria-label={`Remove ${name || 'this variable'}`} onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="link-button" onClick={() => setRows((r) => [...r, ['', '']])}>
        + Add a variable
      </button>
      {bad !== undefined && <p className="sphinx-error">“{bad || '(empty)'}” can’t be a variable name: use letters, digits and _, not starting with a digit, each name once.</p>}
      <div className="modal-actions">
        <button type="button" onClick={() => onEditing(false)} disabled={saving}>
          Cancel
        </button>
        <button type="button" className="primary" disabled={saving || bad !== undefined} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save and rebuild'}
        </button>
      </div>
    </section>
  );
}

interface ChipProps {
  state: BuildState;
  project?: string; // named when the folder has several projects
  problems: number;
  onShowProblems: () => void;
  onShowDetails: () => void;
  onEnable: () => void;
}

export function SphinxChip({ state, project, problems, onShowProblems, onShowDetails, onEnable }: ChipProps) {
  const { status, info } = state;
  const prefix = project ? `${project}: ` : '';
  switch (status.kind) {
    case 'off':
    case 'needs-trust':
      return null;
    case 'declined':
      return (
        <button type="button" className="chip-button" onClick={onEnable} title="Build with Sphinx to check links and preview pages">
          Preview off
        </button>
      );
    case 'setting-up':
      return (
        <button type="button" className="chip-button busy" onClick={onShowDetails} title="Show details">
          <span className="spinner" aria-hidden="true" />
          {status.step}…
        </button>
      );
    case 'building':
    case 'ready': {
      const label = prefix + (status.kind === 'building' ? 'Building…' : info ? `Built in ${info.duration.toFixed(1)} s` : 'Ready');
      return (
        <>
          <button type="button" className={`chip-button${status.kind === 'building' ? ' busy' : ''}`} onClick={onShowDetails} title={info ? `${info.builtWith.name} ${info.builtWith.version}` : undefined}>
            {status.kind === 'building' && <span className="spinner" aria-hidden="true" />}
            {label}
          </button>
          {info && (
            <button type="button" className={`chip-button${problems ? ' has-problems' : ''}`} onClick={onShowProblems}>
              {problems ? `${problems} problem${problems === 1 ? '' : 's'}` : 'No problems'}
            </button>
          )}
        </>
      );
    }
    case 'error':
      return (
        <button type="button" className="chip-button failed" onClick={onShowDetails} title={status.message}>
          {status.offline ? 'Offline — choose Python…' : `${prefix}Build failed — details`}
        </button>
      );
  }
}

interface ProblemsProps {
  warnings: BuildWarning[];
  titles: Record<string, string>;
  current: string | null;
  onOpen: (source: string, line: number | null) => void;
  onClose: () => void;
}

export function ProblemsPanel({ warnings, titles, current, onOpen, onClose }: ProblemsProps) {
  // The open page first, then by file and line.
  const groups = useMemo(() => {
    const by = new Map<string, BuildWarning[]>();
    for (const w of warnings) {
      const key = w.source ?? '';
      by.set(key, [...(by.get(key) ?? []), w]);
    }
    return [...by.entries()]
      .map(([source, list]) => [source, list.sort((a, b) => (a.line ?? 0) - (b.line ?? 0))] as const)
      .sort(([a], [b]) => Number(b === current) - Number(a === current) || (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  }, [warnings, current]);
  const panel = usePanelHeight();

  return (
    <section className="problems" aria-label="Problems" ref={panel.ref} style={panel.style}>
      {panel.handle}
      <header>
        <strong>Problems</strong>
        <span className="muted">{warnings.length ? `${warnings.length} from the last build` : 'None — the last build was clean'}</span>
        <span className="spacer" />
        <button type="button" className="link-button" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="problems-list">
        {groups.map(([source, list]) => (
          <div key={source} className="problem-group">
            <div className="problem-file">{source ? (titles[source] ? `${titles[source]} — ${source}` : source) : 'Whole project'}</div>
            {list.map((w, i) => (
              <button
                type="button"
                key={i}
                className={`problem ${w.level}`}
                disabled={!source}
                onClick={() => source && onOpen(source, w.line)}
                title={w.type ? `Sphinx: ${w.type}` : undefined}
              >
                <span className="problem-level">{w.level === 'warning' ? 'Warning' : 'Error'}</span>
                {w.line && <span className="muted">line {w.line}</span>}
                <span className="problem-message">{w.message}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

// Where the preview should be: the source line at the top of the editor (a fraction
// part way through a block), or the end.
export type PreviewLine = number | 'end' | null;

export function Preview({ url, building, line = null }: { url: string | null; building: boolean; line?: PreviewLine }) {
  // A new build loads out of sight and replaces the shown page once it has scrolled to
  // the same place, so the preview doesn't flash or jump.
  const [shown, setShown] = useState(url);
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const lineRef = useRef(line);
  lineRef.current = line;
  const urlRef = useRef(url);
  urlRef.current = url;
  // The page scrolls itself there (see main/sphinx/preview.ts) and says when it has.
  const follow = (src: string | null) => {
    if (lineRef.current !== null && src) frames.current.get(src)?.contentWindow?.postMessage({ mysteditorScroll: lineRef.current }, '*');
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => follow(shown), [line, shown]);
  const next = url && url !== shown ? url : null;
  useEffect(() => {
    if (!url) setShown(null);
    if (!next) return;
    const onMessage = (e: MessageEvent) => {
      if (e.source === frames.current.get(next)?.contentWindow && e.data?.mysteditorScrolled) setShown(next);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [url, next]);
  const onLoad = (src: string) => {
    if (src !== next) return follow(src);
    if (lineRef.current === null) return setShown(src);
    follow(src);
    setTimeout(() => urlRef.current === src && setShown(src), 500); // in case it can't say
  };
  const srcs = [shown, next].filter((s): s is string => !!s);
  return (
    <aside className="preview" aria-label="Preview">
      {srcs.length ? (
        // Sandboxed, and on its own myst-build:// origin, so the built page's scripts
        // can't reach the app.
        srcs.map((src) => (
          <iframe
            key={src}
            ref={(el) => {
              if (el) frames.current.set(src, el);
              else frames.current.delete(src);
            }}
            className={src === next ? 'preview-next' : undefined}
            title={src === next ? 'Next Sphinx preview' : 'Sphinx preview'}
            aria-hidden={src === next || undefined}
            tabIndex={src === next ? -1 : undefined}
            src={src}
            sandbox="allow-scripts allow-same-origin"
            onLoad={() => onLoad(src)}
          />
        ))
      ) : (
        <div className="preview-empty muted">{building ? 'Building the preview…' : 'No preview for this page yet.'}</div>
      )}
    </aside>
  );
}
