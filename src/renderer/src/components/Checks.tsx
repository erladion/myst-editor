// The page's checks, from the status bar's chip: what core/checks.ts finds, each to
// go to or to fix; and the same for every page of the folder, when asked.
import { useState } from 'react';
import type { Finding } from '../../../core/checks';
import { usePanelHeight } from './PanelResize';

export interface PageFindings {
  path: string;
  title: string;
  findings: Finding[];
}

const FIX_LABEL: Record<NonNullable<Finding['fix']>['kind'], string> = {
  'describe-image': 'Describe…',
  'describe-figure': 'Describe…',
  'heading-level': 'Fix the level',
  'link-text': 'Edit the link…',
};

export function ChecksChip({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button type="button" className={`chip-button${count ? ' checks-some' : ''}`} title="Checks for images without descriptions, skipped heading levels, vague links and more" onClick={onClick}>
      {count ? `${count} to check` : 'Checks'}
    </button>
  );
}

interface Props {
  findings: Finding[]; // the open page's
  onShow: (f: Finding) => void;
  onFix: (f: Finding) => void;
  checkAll: () => Promise<PageFindings[]>;
  onOpen: (path: string, index: number) => void; // a finding on another page, by its place in that page's list
  onClose: () => void;
}

export function ChecksPanel({ findings, onShow, onFix, checkAll, onOpen, onClose }: Props) {
  const [all, setAll] = useState<PageFindings[] | null>(null);
  const [busy, setBusy] = useState(false);
  const total = all?.reduce((n, p) => n + p.findings.length, 0) ?? 0;
  const panel = usePanelHeight();
  return (
    <section className="problems checks" aria-label="Checks" ref={panel.ref} style={panel.style}>
      {panel.handle}
      <header>
        <strong>Checks</strong>
        <span className="muted">{findings.length ? `${findings.length} on this page` : 'Nothing to check on this page'}</span>
        <span className="spacer" />
        <button
          type="button"
          className="link-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setAll(await checkAll());
            setBusy(false);
          }}
        >
          {busy ? 'Checking…' : 'Check all pages'}
        </button>
        <button type="button" className="link-button" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="problems-list">
        {findings.map((f, i) => (
          <div key={`${f.kind}-${f.from}-${i}`} className="check">
            <button type="button" className="problem" onClick={() => onShow(f)}>
              <span className="problem-message">{f.message}</span>
            </button>
            {f.fix && (
              <button type="button" className="check-fix" onClick={() => onFix(f)}>
                {FIX_LABEL[f.fix.kind]}
              </button>
            )}
          </div>
        ))}
        {all && (
          <div className="checks-all" aria-label="All pages">
            <div className="problem-file">{total ? `All pages: ${total} to check, on ${all.length} page${all.length === 1 ? '' : 's'}` : 'All pages: nothing to check'}</div>
            {all.map((p) => (
              <div key={p.path} className="problem-group">
                <div className="problem-file">
                  {p.title} — {p.path}
                </div>
                {p.findings.map((f, i) => (
                  <button type="button" key={i} className="problem" onClick={() => onOpen(p.path, i)}>
                    <span className="problem-message">{f.message}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
