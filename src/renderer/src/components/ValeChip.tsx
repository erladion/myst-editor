// Vale in the status bar: how many remarks it has on the page (a click goes to the
// next), or that it failed. Nothing when it isn't installed or set up for the page.
import type { ValeResult } from '../../../shared/vale';

export function ValeChip({ result, onNext, onShowError }: { result: ValeResult; onNext: () => void; onShowError: (text: string) => void }) {
  if (result.status === 'unavailable') {
    if (result.reason !== 'failed') return null;
    return (
      <button type="button" className="chip-button has-problems" onClick={() => onShowError(result.message)}>
        Vale failed
      </button>
    );
  }
  const n = result.alerts.length;
  return (
    <button type="button" className="chip-button vale-chip" title={n ? 'Checked with Vale: go to the next remark' : 'Checked with Vale'} onClick={onNext} disabled={!n}>
      {n ? `Style: ${n} remark${n === 1 ? '' : 's'}` : 'Style: no remarks'}
    </button>
  );
}
