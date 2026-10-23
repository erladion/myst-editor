// Vale's alerts for the open page: checked when it opens and after each save, if Vale
// is installed and configured for it (otherwise the result says why not), and
// accepting a word it flags.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ValeAlert, ValeResult } from '../../../shared/vale';

const api = window.myst;

// Stable while there are none, so the views don't redraw for nothing.
export const NO_ALERTS: ValeAlert[] = [];

export function useVale(path: string | null, savedText: string | null, root: string | null, notify: (message: string) => void) {
  const [found, setFound] = useState<{ path: string; text: string; result: ValeResult } | null>(null);
  const [again, setAgain] = useState(0); // check again (a word was accepted)
  useEffect(() => {
    if (!path || savedText === null) return;
    let stale = false;
    const timer = setTimeout(() => {
      void api.valeLint(path).then(
        (result) => !stale && setFound({ path, text: savedText, result }),
        () => {},
      );
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [path, savedText, again]);
  const current = found && found.path === path ? found : null;

  const acceptWord = useCallback(
    async (word: string) => {
      if (!path || !root) return;
      const result = await api.valeAccept(path, word);
      if (!result.ok) return void notify(result.message);
      setAgain((n) => n + 1);
      const where = result.file.startsWith(root) ? result.file.slice(root.length + 1) : result.file;
      notify(`“${word}” accepted: added to ${where.split('\\').join('/')}${result.addedVocab ? ' (and Vocab = Project to .vale.ini)' : ''}.`);
    },
    [path, root, notify],
  );
  // For the views: the alerts, and the saved text they're about.
  const alerts = useMemo(() => (current?.result.status === 'ok' ? { text: current.text, alerts: current.result.alerts } : null), [current]);
  return { result: current?.result ?? null, alerts, acceptWord };
}
