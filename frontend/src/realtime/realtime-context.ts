import { createContext } from 'react';
export interface ResourceEvent {
  eventId: string;
  id: string;
  operation: 'created' | 'updated' | 'deleted';
}
export interface RealtimeEvents {
  'order:changed': ResourceEvent;
  'product:changed': ResourceEvent;
  'category:changed': ResourceEvent;
  'realtime:connected': undefined;
}
export type RealtimeStatus = 'connecting' | 'connected' | 'disconnected';
export type Subscribe = <K extends keyof RealtimeEvents>(
  event: K,
  listener: (payload: RealtimeEvents[K]) => void,
) => () => void;
export const RealtimeContext = createContext<{
  status: RealtimeStatus;
  subscribe: Subscribe;
} | null>(null);
