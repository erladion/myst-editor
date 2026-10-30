// Help → About: the app's version, and what it runs on (for bug reports).
import { useEffect, useState } from 'react';
import type { AboutInfo } from '../../../shared/api';
import { PRODUCT } from '../../../shared/product';

const api = window.myst;

export function AboutDialog({ builtWith, onClose }: { builtWith: { name: string; version: string } | null; onClose: () => void }) {
  const [info, setInfo] = useState<AboutInfo | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    void api.about().then(setInfo);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const rows: [string, string][] = info
    ? [
        ['Electron', info.electron],
        ['Chromium', info.chromium],
        ['Node', info.node],
        ...(builtWith ? ([[builtWith.name, builtWith.version]] as [string, string][]) : []),
        ['System', info.system],
      ]
    : [];
  const copy = async () => {
    if (!info) return;
    await navigator.clipboard.writeText([`${PRODUCT.name} ${info.version}`, ...rows.map(([k, v]) => `${k}: ${v}`)].join('\n'));
    setCopied(true);
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal about" role="dialog" aria-modal="true" aria-label={`About ${PRODUCT.name}`}>
        <h2>{PRODUCT.name}</h2>
        <p className="about-version">{info ? `Version ${info.version}` : ' '}</p>
        <p className="muted">Edit Sphinx documentation written in MyST Markdown as formatted pages.</p>
        <dl className="about-details">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <div className="modal-actions">
          <button type="button" onClick={() => void copy()} disabled={!info}>
            {copied ? 'Copied' : 'Copy details'}
          </button>
          <button type="button" className="primary" autoFocus onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
