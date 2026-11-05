import { randomUUID } from 'node:crypto';
import { RealtimeService } from '../dist/realtime/realtime.service.js';
import type { AccessTokenService } from '../dist/auth/access-token.service.js';
import type { Socket } from 'socket.io';

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
