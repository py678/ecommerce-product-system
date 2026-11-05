import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Socket } from 'socket.io';
import { AccessTokenService } from '../auth/access-token.service.js';
import type {
  Resource,
  Operation,
  SessionReason,
  ResourceEvent,
} from './realtime.events.js';

type Verified = Awaited<ReturnType<AccessTokenService['verify']>>;
type Entry = {
  socket: Socket;
  verified: Verified;
  expiry: ReturnType<typeof setTimeout>;
};
@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly clients = new Map<string, Entry>();
  private checking = false;
  private readonly interval: ReturnType<typeof setInterval>;
  constructor(private readonly tokens: AccessTokenService) {
    this.interval = setInterval(() => {
      void this.checkSessions();
    }, 30_000);
    this.interval.unref();
  }
  register(socket: Socket, verified: Verified) {
    if (verified.expiresAt <= Date.now()) {
      socket.disconnect(true);
      return;
    }
    const expiry = setTimeout(
      () => this.invalidate(socket.id, 'expired'),
      Math.min(verified.expiresAt - Date.now(), 2147483647),
    );
    expiry.unref();
    this.clients.set(socket.id, { socket, verified, expiry });
    socket.once('disconnect', () => this.unregister(socket.id));
  }
  private unregister(id: string) {
    const entry = this.clients.get(id);
    if (entry) clearTimeout(entry.expiry);
    this.clients.delete(id);
  }
  private invalidate(id: string, reason: SessionReason) {
    const entry = this.clients.get(id);
    if (!entry) return;
    // Remove first so a failed transport can never leave an authenticated broadcast recipient.
    this.unregister(id);
    try {
      entry.socket.emit('session:invalidated', { reason });
    } catch {
      this.logger.warn('会话失效通知发送失败');
    } finally {
      try {
        entry.socket.disconnect(true);
      } catch {
        this.logger.warn('会话传输关闭失败');
      }
    }
  }
  resourceChanged(resource: Resource, id: string, operation: Operation) {
    const payload: ResourceEvent = { eventId: randomUUID(), id, operation };
    for (const [key, entry] of this.clients) {
      try {
        if (entry.verified.expiresAt <= Date.now())
          this.invalidate(key, 'expired');
        else entry.socket.emit(resource + ':changed', payload);
      } catch {
        this.logger.warn('实时通知发送失败，客户端可重新获取数据');
      }
    }
  }
  orderChanged(
    id: string,
    creatorId: string,
    operation: 'created' | 'updated',
  ) {
    const payload = { eventId: randomUUID(), id, operation };
    for (const [key, entry] of this.clients) {
      if (entry.verified.expiresAt <= Date.now()) {
        this.invalidate(key, 'expired');
        continue;
      }
      if (
        entry.verified.user.id === creatorId ||
        entry.verified.user.role === 'ADMIN'
      ) {
        try {
          entry.socket.emit('order:changed', payload);
        } catch {
          this.logger.warn('订单实时通知失败');
        }
      }
    }
  }
  revokeUser(id: string, reason: SessionReason) {
    for (const [key, entry] of this.clients)
      if (entry.verified.user.id === id) {
        try {
          this.invalidate(key, reason);
        } catch {
          this.logger.warn('会话断开通知失败');
        }
      }
  }
  async checkSessions() {
    if (this.checking) return;
    this.checking = true;
    try {
      for (const [id, entry] of this.clients) {
        if (entry.verified.expiresAt <= Date.now()) {
          this.invalidate(id, 'expired');
          continue;
        }
        try {
          // Shared verifier performs a fresh DB read; no tokenVersion cache.
          // We retain verified claims, never the raw JWT, in the connection registry.
          await this.tokens.checkUser(
            entry.verified.user.id,
            entry.verified.tokenVersion,
          );
        } catch (error) {
          if (
            error instanceof Error &&
            'getStatus' in error &&
            typeof error.getStatus === 'function' &&
            error.getStatus() === 401
          )
            this.invalidate(id, 'securityChanged');
          else {
            this.unregister(id);
            entry.socket.disconnect(true);
          }
        }
      }
    } finally {
      this.checking = false;
    }
  }
  onModuleDestroy() {
    clearInterval(this.interval);
    for (const [id, entry] of this.clients) {
      this.unregister(id);
      entry.socket.disconnect(true);
    }
  }
}

// Notifications happen after persistence, and must never roll back HTTP success.
const notificationLogger = new Logger('RealtimeNotification');
export function notifyResourceChange(
  service: RealtimeService,
  resource: Resource,
  id: string,
  operation: Operation,
) {
  try {
    service.resourceChanged(resource, id, operation);
  } catch {
    notificationLogger.warn('已提交操作的实时通知失败，请刷新数据');
  }
}
export function notifySessionChange(
  service: RealtimeService,
  id: string,
  reason: SessionReason,
) {
  try {
    service.revokeUser(id, reason);
  } catch {
    notificationLogger.warn('已提交安全变更的实时通知失败');
  }
}
