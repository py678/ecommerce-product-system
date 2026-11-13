import { randomUUID } from 'node:crypto';
import { RealtimeService } from '../dist/realtime/realtime.service.js';
import type { AccessTokenService } from '../dist/auth/access-token.service.js';
import type { Socket } from 'socket.io';
import { OrdersService } from '../dist/orders/orders.service.js';
import type { Actor } from '../dist/auth/permissions.js';
import type { DatabaseService } from '../dist/database/database.service.js';
import type { CommerceAuthorityService } from '../dist/commerce/commerce.module.js';

describe('Order date filters keep existing resource scope', () => {
  it.each(['OWN', 'ALL'] as const)(
    'combines date/search/status and reuses the same where for %s rows and total',
    async (scope) => {
      const findMany = vi.fn().mockResolvedValue([]);
      const count = vi.fn().mockResolvedValue(0);
      const db = {
        order: { findMany, count },
        $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
      };
      const service = new OrdersService(
        db as unknown as DatabaseService,
        {} as CommerceAuthorityService,
        {} as RealtimeService,
      );
      const actor: Actor = {
        id: 'owner-id',
        role: 'CUSTOM',
        permissions: ['order:read'],
        dataScopes: { 'order:read': scope },
      };
      const result = await service.findAll(actor, {
        page: 2,
        pageSize: 10,
        search: 'ORD-demo',
        status: 'PENDING',
        createdFrom: '2026-11-12T16:00:00.000Z',
        createdTo: '2026-11-13T15:59:59.999Z',
      });
      const where = findMany.mock.calls[0][0].where;
      expect(count.mock.calls[0][0].where).toBe(where);
      expect(where.creatorId).toBe(scope === 'OWN' ? actor.id : undefined);
      expect(where.status).toBe('PENDING');
      expect(where.OR[0].orderNo.contains).toBe('ORD-demo');
      expect(where.createdAt).toEqual({
        gte: new Date('2026-11-12T16:00:00.000Z'),
        lte: new Date('2026-11-13T15:59:59.999Z'),
      });
      expect(findMany.mock.calls[0][0]).toMatchObject({ skip: 10, take: 10 });
      expect(result).toMatchObject({ list: [], total: 0, page: 2 });
    },
  );
});

describe('Order realtime privacy', () => {
  it('notifies only creator and admins without customer data; transport failure is isolated', () => {
    const realtime = new RealtimeService({} as AccessTokenService);
    const creator = randomUUID();
    const sockets = Array.from({ length: 4 }, () => ({
      id: randomUUID(),
      emit: vi.fn(),
      once: vi.fn(),
      disconnect: vi.fn(),
    }));
    for (const [i, socket] of sockets.entries())
      realtime.register(
        socket as unknown as Socket,
        {
          user: {
            id: i === 0 || i === 3 ? creator : randomUUID(),
            role: i === 1 ? 'ADMIN' : 'OPERATOR',
            permissions: ['order:read'],
            dataScopes: { 'order:read': i === 1 ? 'ALL' : 'OWN' },
          },
          expiresAt: Date.now() + 60000,
          tokenVersion: 0,
        } as never,
      );
    sockets[3].emit.mockImplementation(() => {
      throw new Error('transport failure');
    });
    const id = randomUUID();
    expect(() => realtime.orderChanged(id, creator, 'updated')).not.toThrow();
    for (const i of [0, 1])
      expect(sockets[i].emit).toHaveBeenCalledWith('order:changed', {
        eventId: expect.any(String),
        id,
        operation: 'updated',
      });
    expect(sockets[2].emit).not.toHaveBeenCalled();
    realtime.onModuleDestroy();
  });
});

// Verified permissions, rather than the role label, govern realtime visibility.
describe('Configurable realtime scopes', () => {
  it('sends product/order hints only to authorized OWN or ALL recipients', () => {
    const realtime = new RealtimeService({} as AccessTokenService);
    const sockets = Array.from({ length: 4 }, () => ({
      id: randomUUID(),
      emit: vi.fn(),
      once: vi.fn(),
      disconnect: vi.fn(),
    }));
    const owner = randomUUID();
    for (const [i, socket] of sockets.entries())
      realtime.register(
        socket as unknown as Socket,
        {
          user: {
            id: i === 0 ? owner : randomUUID(),
            role: i === 3 ? 'ADMIN' : 'CUSTOM',
            permissions: i === 3 ? [] : ['product:read', 'order:read'],
            dataScopes: {
              'product:read': i === 1 ? 'ALL' : 'OWN',
              'order:read': i === 1 ? 'ALL' : 'OWN',
            },
          },
          expiresAt: Date.now() + 60000,
          tokenVersion: 0,
        } as never,
      );
    realtime.resourceChanged('product', randomUUID(), 'updated', owner);
    realtime.orderChanged(randomUUID(), owner, 'updated');
    expect(sockets[0].emit).toHaveBeenCalledTimes(2);
    expect(sockets[1].emit).toHaveBeenCalledTimes(2);
    expect(sockets[2].emit).not.toHaveBeenCalled();
    expect(sockets[3].emit).not.toHaveBeenCalled();
    realtime.onModuleDestroy();
  });
});
