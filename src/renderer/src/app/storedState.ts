// A per-viewer preference kept in localStorage (which may be unavailable).
import { useCallback, useState } from 'react';

export function useStoredState<T extends string>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T | null) ?? initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: T | ((v: T) => T)) =>
      setValue((prev) => {
        const v = typeof next === 'function' ? next(prev) : next;
        try {
          localStorage.setItem(key, v);
        } catch {
          // not persisted; fine for a preference
        }
        return v;
      }),
    [key],
  );
  return [value, set] as const;
}
