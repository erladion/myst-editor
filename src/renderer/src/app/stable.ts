// A function that keeps its identity while always calling the latest `fn`: for the
// props of components that skip re-rendering while their props are unchanged (the
// sidebar, which a large folder makes slow to redraw on every keystroke).
import { useCallback, useRef } from 'react';

export function useStable<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useRef(fn);
  latest.current = fn;
  return useCallback((...args: A) => latest.current(...args), []);
}
