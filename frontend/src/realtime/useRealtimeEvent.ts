import { useContext, useEffect, useLayoutEffect, useRef } from 'react';
import { RealtimeContext, type RealtimeEvents } from './realtime-context';
export function useRealtime() {
  const context = useContext(RealtimeContext);
  if (!context) throw new Error('RealtimeProvider is required');
  return context;
}
export function useRealtimeEvent<K extends keyof RealtimeEvents>(
  event: K,
  listener: (payload: RealtimeEvents[K]) => void,
) {
  const { subscribe } = useRealtime();
  const latest = useRef(listener);
  useLayoutEffect(() => {
    latest.current = listener;
  });
  useEffect(
    () => subscribe(event, (payload) => latest.current(payload)),
    [event, subscribe],
  );
}
