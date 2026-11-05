import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useRealtimeEvent } from './useRealtimeEvent';
// Resource events and reconnect recovery share one trailing 300ms debounce.
// refresh reads the page's current loader: URL/filter/sort/page are never reset.
export function useRealtimeRefresh(
  refresh: () => void,
  {
    products = false,
    categories = false,
    paused = false,
  }: { products?: boolean; categories?: boolean; paused?: boolean } = {},
) {
  const timer = useRef<ReturnType<typeof window.setTimeout> | undefined>(
    undefined,
  );
  const pending = useRef(false);
  const latest = useRef({ refresh, paused });
  useLayoutEffect(() => {
    latest.current = { refresh, paused };
  });
  const schedule = useCallback(() => {
    pending.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (!latest.current.paused) {
        pending.current = false;
        latest.current.refresh();
      }
    }, 300);
  }, []);
  useRealtimeEvent('product:changed', () => {
    if (products) schedule();
  });
  useRealtimeEvent('category:changed', () => {
    if (categories) schedule();
  });
  useRealtimeEvent('realtime:connected', schedule);
  useEffect(() => {
    if (!paused && pending.current) schedule();
  }, [paused, schedule]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
}
