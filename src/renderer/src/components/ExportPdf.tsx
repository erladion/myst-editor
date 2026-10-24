// File → Export PDF: asks where to save it, then shows what's happening (a Sphinx
// build and two prints can take a while for a big manual), and the result.
import { useEffect, useState } from 'react';
import type { PdfResult } from '../../../shared/api';

const api = window.myst;

export function ExportPdfDialog({ projectId, onClose }: { projectId: string | null; onClose: () => void }) {
  const [step, setStep] = useState('Choose where to save the PDF…');
  const [result, setResult] = useState<PdfResult | null>(null);
  useEffect(() => {
    let live = true;
    const off = api.onPdfProgress((s) => live && setStep(s));
    void api.exportPdf(projectId).then((r) => {
      if (!live) return;
      if (r) setResult(r);
      else onClose();
    });
    return () => {
      live = false;
      off();
    };
  }, [projectId, onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && result && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [result, onClose]);

  return (
    <div className="modal-backdrop">
      <div className="modal export-pdf" role="dialog" aria-modal="true" aria-label="Export PDF">
        <h2>Export PDF</h2>
        {!result ? (
          <>
            <p className="pdf-step" role="status">
              <span className="spinner" aria-hidden="true" />
              {step}
            </p>
            <div className="modal-actions">
              <button type="button" onClick={() => void api.cancelPdf().then(onClose)}>
                Cancel
              </button>
            </div>
          </>
        ) : result.ok ? (
          <>
            <p role="status">
              Saved {result.pages} page{result.pages === 1 ? '' : 's'} as <code>{result.path}</code>.
            </p>
            <div className="modal-actions">
              <button type="button" onClick={() => void api.openPdf(true)}>
                Show in Folder
              </button>
              <button type="button" onClick={onClose}>
                Close
              </button>
              <button type="button" className="primary" autoFocus onClick={() => void api.openPdf(false).then(onClose)}>
                Open PDF
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="sphinx-error" role="alert">
              {result.message}
            </p>
            <div className="modal-actions">
              <button type="button" className="primary" autoFocus onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
