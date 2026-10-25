// Help → Keyboard Shortcuts: all of them, by what they're for.
import { useEffect } from 'react';
import { SHORTCUTS } from '../shortcuts';

export function ShortcutsDialog({ emacs, onClose }: { emacs: boolean; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal shortcuts" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <h2>Keyboard shortcuts</h2>
        {emacs && <p className="modal-help">Emacs keys are on: the Emacs ones are in the README, and these still work where Emacs doesn’t use the keys.</p>}
        <div className="shortcut-groups">
          {SHORTCUTS.map(({ group, keys }) => (
            <section key={group}>
              <h3>{group}</h3>
              <table>
                <tbody>
                  {keys.map(([what, key]) => (
                    <tr key={what}>
                      <td>{what}</td>
                      <td>
                        <kbd>{key}</kbd>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" className="primary" autoFocus onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
