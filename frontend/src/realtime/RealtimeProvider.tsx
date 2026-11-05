import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { io } from 'socket.io-client';
import { useAuth } from '../auth/useAuth';
import {
  expireSession,
  sessionToken,
  type SessionExpiryReason,
} from '../auth/session';
import {
  RealtimeContext,
  type RealtimeEvents,
  type RealtimeStatus,
  type Subscribe,
} from './realtime-context';

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [status, setStatus] = useState<RealtimeStatus>('disconnected');
  const listeners = useRef(
    new Map<keyof RealtimeEvents, Set<(payload: never) => void>>(),
  );
  const subscribe = useCallback<Subscribe>((event, listener) => {
    const group = listeners.current.get(event) ?? new Set();
    group.add(listener as (payload: never) => void);
    listeners.current.set(event, group);
    return () => {
      group.delete(listener as (payload: never) => void);
    };
  }, []);
  const userId = user?.id;
  const token = userId ? sessionToken.get() : null;
  useEffect(() => {
    if (!userId || !token) {
      setStatus('disconnected');
      return;
    }
    let active = true;
    let retry: ReturnType<typeof window.setTimeout> | undefined;
    const socket = io({
      path: '/socket.io/',
      auth: { token },
      autoConnect: false,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 8000,
    });
    const emit = <K extends keyof RealtimeEvents>(
      event: K,
      payload: RealtimeEvents[K],
    ) => {
      if (active)
        listeners.current
          .get(event)
          ?.forEach((listener) => listener(payload as never));
    };
    const invalidate = (reason: SessionExpiryReason) => {
      if (!active || sessionToken.get() !== token) return;
      socket.disconnect();
      expireSession(reason);
    };
    setStatus('connecting');
    socket.on('connect', () => {
      if (active) {
        setStatus('connected');
        emit('realtime:connected', undefined);
      }
    });
    socket.on('product:changed', (payload) => emit('product:changed', payload));
    socket.on('category:changed', (payload) =>
      emit('category:changed', payload),
    );
    socket.on('session:invalidated', ({ reason }: { reason?: string }) =>
      invalidate(
        reason === 'passwordChanged'
          ? 'passwordChanged'
          : reason === 'expired'
            ? 'expired'
            : 'securityChanged',
      ),
    );
    socket.on(
      'connect_error',
      (error: Error & { data?: { code?: string } }) => {
        if (!active) return;
        setStatus('disconnected');
        if (error.data?.code === 'UNAUTHORIZED') invalidate('expired');
        else if (error.data?.code === 'SESSION_REVOKED')
          invalidate('securityChanged');
        else if (!socket.active)
          retry = window.setTimeout(() => socket.connect(), 1000);
        // Transport/network failures preserve HTTP login and manual refresh.
      },
    );
    socket.on('disconnect', (reason) => {
      if (!active) return;
      setStatus('disconnected');
      // Server restarts/temporary DB outages may explicitly disconnect a socket.
      if (reason === 'io server disconnect' && sessionToken.get() === token)
        retry = window.setTimeout(() => socket.connect(), 1000);
    });
    socket.io.on('reconnect_attempt', () => {
      if (active) setStatus('connecting');
    });
    socket.connect();
    return () => {
      active = false;
      window.clearTimeout(retry);
      socket.removeAllListeners();
      socket.io.removeAllListeners();
      socket.disconnect();
    };
  }, [userId, token]);
  const value = useMemo(() => ({ status, subscribe }), [status, subscribe]);
  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  );
}
