// Sphinx in the UI: the permission banner, the status chip, the problems list and
// the preview pane.
import { useMemo } from 'react';
import type { SphinxState, SphinxWarning } from '../../../shared/sphinx';

interface TrustProps {
  state: SphinxState;
  onAllow: () => void;
  onDecline: () => void;
}

export function TrustBanner({ state, onAllow, onDecline }: TrustProps) {
  if (state.status.kind !== 'needs-trust') return null;
  return (
    <div className="banner info" role="region" aria-label="Preview">
      <div>
        <strong>Check links and preview pages with Sphinx?</strong> This builds the documentation in the background,
        which runs the project’s <code>conf.py</code> and installs its documentation packages (from{' '}
        {state.status.requirements}) in a private environment. Only allow this for projects you trust.
      </div>
      <div className="banner-actions">
        <button type="button" onClick={onDecline}>
          Not now
        </button>
        <button type="button" className="primary" onClick={onAllow}>
          Allow
        </button>
      </div>
    </div>
  );
}

interface ChipProps {
  state: SphinxState;
  problems: number;
  onShowProblems: () => void;
  onShowLog: () => void;
  onEnable: () => void;
}

export function SphinxChip({ state, problems, onShowProblems, onShowLog, onEnable }: ChipProps) {
  const { status, info } = state;
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
        <button type="button" className="chip-button busy" onClick={onShowLog} title="Show details">
          <span className="spinner" aria-hidden="true" />
          {status.step}…
        </button>
      );
    case 'building':
    case 'ready': {
      const label = status.kind === 'building' ? 'Building…' : info ? `Built in ${info.duration.toFixed(1)} s` : 'Ready';
      return (
        <>
          <button type="button" className={`chip-button${status.kind === 'building' ? ' busy' : ''}`} onClick={onShowLog} title={info ? `Sphinx ${info.sphinxVersion}` : undefined}>
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
        <button type="button" className="chip-button failed" onClick={onShowLog} title={status.message}>
          Build failed — details
        </button>
      );
  }
}

interface ProblemsProps {
  warnings: SphinxWarning[];
  titles: Record<string, string>;
  current: string | null;
  onOpen: (source: string, line: number | null) => void;
  onClose: () => void;
}

export function ProblemsPanel({ warnings, titles, current, onOpen, onClose }: ProblemsProps) {
  // The open page first, then by file and line.
  const groups = useMemo(() => {
    const by = new Map<string, SphinxWarning[]>();
    for (const w of warnings) {
      const key = w.source ?? '';
      by.set(key, [...(by.get(key) ?? []), w]);
    }
    return [...by.entries()]
      .map(([source, list]) => [source, list.sort((a, b) => (a.line ?? 0) - (b.line ?? 0))] as const)
      .sort(([a], [b]) => Number(b === current) - Number(a === current) || (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  }, [warnings, current]);

  return (
    <section className="problems" aria-label="Problems">
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

export function Preview({ url, building }: { url: string | null; building: boolean }) {
  return (
    <aside className="preview" aria-label="Preview">
      {url ? (
        // Sandboxed, and on its own myst-build:// origin, so the built page's scripts
        // can't reach the app.
        <iframe title="Sphinx preview" src={url} sandbox="allow-scripts allow-same-origin" />
      ) : (
        <div className="preview-empty muted">{building ? 'Building the preview…' : 'No preview for this page yet.'}</div>
      )}
    </aside>
  );
}
