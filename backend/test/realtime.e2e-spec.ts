import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { io, type Socket } from 'socket.io-client';
import { AuthModule } from '../dist/auth/auth.module.js';
import { DatabaseService } from '../dist/database/database.service.js';
import { ProductsModule } from '../dist/products/products.module.js';
import { ProductsService } from '../dist/products/products.service.js';
import { RealtimeModule } from '../dist/realtime/realtime.module.js';
import { RealtimeService } from '../dist/realtime/realtime.service.js';
import type { Prisma } from '../dist/generated/prisma/client.js';

// Real network handshake and JWT verification; only persistence is replaced.
describe.sequential('Realtime authenticated transport', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let realtime: RealtimeService;
  let url: string;
  const sockets: Socket[] = [];
  const user = {
    id: randomUUID(),
    username: 'realtime_fixture',
    email: 'realtime@example.invalid',
    role: 'OPERATOR',
    roleId: randomUUID(),
    roleDefinition: {
      code: 'OPERATOR',
      name: '运营人员',
      enabled: true,
      grants: [
        { permissionCode: 'product:read', scope: 'ALL' },
        { permissionCode: 'category:read', scope: 'ALL' },
      ],
    },
    tokenVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const otherUser = { ...user, id: randomUUID(), username: 'realtime_other' };
  const product = {
    id: randomUUID(),
    userId: user.id,
    categoryId: randomUUID(),
    name: 'Realtime item',
    description: '',
    coverImage: null,
    stock: 10,
    stockVersion: 0,
    price: { toFixed: () => '12.00' },
    createdAt: new Date(),
    updatedAt: new Date(),
    user: { id: user.id, username: user.username },
    category: { id: randomUUID(), name: 'Fixture' },
  };
  const movements: Record<string, unknown>[] = [];
  const db = {
    $queryRaw: vi.fn(async () => [{ id: product.id }]),
    async $transaction(
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
    ) {
      const before = {
        stock: product.stock,
        stockVersion: product.stockVersion,
      };
      const count = movements.length;
      try {
        return await callback(db as unknown as Prisma.TransactionClient);
      } catch (error) {
        Object.assign(product, before);
        movements.splice(count);
        throw error;
      }
    },
    commerceConfig: {
      findUnique: vi.fn(async () => ({ writeRole: 'STANDALONE' })),
    },
    user: {
      findUniqueOrThrow: vi.fn(async () => user),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === user.id
          ? { ...user }
          : where.id === otherUser.id
            ? { ...otherUser }
            : null,
      ),
    },
    product: {
      findUnique: vi.fn(async () => product),
      findFirstOrThrow: vi.fn(async () => ({ ...product })),
      update: vi.fn(async () => {
        product.stock = 11;
        product.stockVersion++;
        return { ...product };
      }),
      create: vi.fn(async () => product),
      delete: vi.fn(async () => product),
    },
    category: { findUnique: vi.fn(async () => ({ id: product.categoryId })) },
    stockMovement: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        movements.push({ ...data });
        return data;
      }),
    },
  };
  function client(token?: string, extra = {}) {
    const socket = io(url, {
      auth: token ? { token } : {},
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      timeout: 1500,
      ...extra,
    });
    sockets.push(socket);
    return socket;
  }
  function connected(socket: Socket) {
    return new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
  }
  function event<T>(socket: Socket, name: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Missing event: ' + name)),
        2000,
      );
      socket.once(name, (value: T) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
  }
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AuthModule, ProductsModule, RealtimeModule],
    })
      .overrideProvider(DatabaseService)
      .useValue(db)
      .compile();
    app = module.createNestApplication();
    app.useLogger(false);
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
    jwt = app.get(JwtService);
    realtime = app.get(RealtimeService);
  });
  afterEach(() => {
    sockets.splice(0).forEach((socket) => socket.disconnect());
    user.tokenVersion = 0;
    product.stock = 10;
    product.stockVersion = 0;
    movements.splice(0);
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    if (app) await app.close();
  });
  it.each([
    'missing',
    'invalid',
    'expired',
    'revoked',
    'audience',
    'issuer',
    'subject',
  ])('rejects %s JWT before connecting', async (kind) => {
    const token =
      kind === 'missing'
        ? undefined
        : kind === 'invalid'
          ? 'invalid-jwt'
          : await jwt.signAsync(
              {
                sub: kind === 'subject' ? 'invalid' : user.id,
                tokenVersion: kind === 'revoked' ? 1 : 0,
              },
              kind === 'expired'
                ? { expiresIn: -1 }
                : kind === 'audience'
                  ? { audience: 'wrong' }
                  : kind === 'issuer'
                    ? { issuer: 'wrong' }
                    : {},
            );
    const socket = client(token);
    const error = await event<{ message: string; data: { code: string } }>(
      socket,
      'connect_error',
    );
    expect(error.data.code).toMatch(/UNAUTHORIZED|SESSION_REVOKED/);
    expect(socket.connected).toBe(false);
    expect(error.message).not.toContain('invalid-jwt');
  });
  it('accepts valid JWT and broadcasts a committed product update to multiple users', async () => {
    const token = await jwt.signAsync({ sub: user.id, tokenVersion: 0 });
    const a = client(token);
    const b = client(
      await jwt.signAsync({ sub: otherUser.id, tokenVersion: 0 }),
    );
    await Promise.all([connected(a), connected(b)]);
    const received = event<Record<string, unknown>>(b, 'product:changed');
    await app
      .get(ProductsService)
      .update(
        product.id,
        { id: user.id, role: 'OPERATOR' },
        { stock: 11, stockVersion: 0, stockReason: '盘点' },
      );
    expect(await received).toEqual({
      id: product.id,
      operation: 'updated',
      eventId: expect.any(String),
    });
    expect(db.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: product.id, userId: user.id, stockVersion: 0 },
      }),
    );
    expect(product.stock).toBe(11);
    expect(movements).toEqual([
      expect.objectContaining({
        type: 'ADJUSTMENT',
        beforeStock: 10,
        afterStock: 11,
        quantityChange: 1,
        stockVersion: 1,
      }),
    ]);
  });
  it('does not broadcast failed writes', async () => {
    const socket = client(
      await jwt.signAsync({ sub: user.id, tokenVersion: 0 }),
    );
    await connected(socket);
    const listener = vi.fn();
    socket.on('product:changed', listener);
    db.product.update.mockRejectedValueOnce(new Error('write failed'));
    await expect(
      app
        .get(ProductsService)
        .update(
          product.id,
          { id: user.id, role: 'OPERATOR' },
          { stock: 11, stockVersion: 0, stockReason: '盘点' },
        ),
    ).rejects.toThrow('write failed');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(listener).not.toHaveBeenCalled();
    expect(product.stock).toBe(10);
    expect(movements).toHaveLength(0);
  });
  it('keeps successful CRUD successful when notification fails', async () => {
    vi.spyOn(realtime, 'resourceChanged').mockImplementation(() => {
      throw new Error('transport failed');
    });
    expect(
      await app
        .get(ProductsService)
        .update(
          product.id,
          { id: user.id, role: 'OPERATOR' },
          { stock: 11, stockVersion: 0, stockReason: '盘点' },
        ),
    ).toMatchObject({ stock: 11 });
  });
  it('rolls back the stock change and emits nothing when the ledger append fails', async () => {
    const socket = client(
      await jwt.signAsync({ sub: user.id, tokenVersion: 0 }),
    );
    await connected(socket);
    const listener = vi.fn();
    socket.on('product:changed', listener);
    db.stockMovement.create.mockRejectedValueOnce(new Error('ledger failed'));
    await expect(
      app
        .get(ProductsService)
        .update(
          product.id,
          { id: user.id, role: 'OPERATOR' },
          { stock: 11, stockVersion: 0, stockReason: '盘点' },
        ),
    ).rejects.toThrow('ledger failed');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(listener).not.toHaveBeenCalled();
    expect(product.stock).toBe(10);
    expect(product.stockVersion).toBe(0);
    expect(movements).toHaveLength(0);
  });
  it('notifies and disconnects only the revoked user and rejects the old JWT', async () => {
    const token = await jwt.signAsync({ sub: user.id, tokenVersion: 0 });
    const socket = client(token);
    await connected(socket);
    const invalidated = event(socket, 'session:invalidated');
    const disconnected = event(socket, 'disconnect');
    user.tokenVersion++;
    realtime.revokeUser(user.id, 'passwordChanged');
    expect(await invalidated).toEqual({ reason: 'passwordChanged' });
    await disconnected;
    const old = client(token);
    expect(
      (await event<{ data: { code: string } }>(old, 'connect_error')).data.code,
    ).toBe('SESSION_REVOKED');
    await connected(
      client(
        await jwt.signAsync({ sub: user.id, tokenVersion: user.tokenVersion }),
      ),
    );
  });
  it('disconnects when JWT expires without waiting for a new HTTP request', async () => {
    const socket = client(
      await jwt.signAsync({ sub: user.id, tokenVersion: 0 }, { expiresIn: 2 }),
    );
    await connected(socket);
    const reason = event(socket, 'session:invalidated');
    await expect(reason).resolves.toEqual({ reason: 'expired' });
  });
  it('rejects an untrusted browser Origin', async () => {
    const socket = client(
      await jwt.signAsync({ sub: user.id, tokenVersion: 0 }),
      { extraHeaders: { Origin: 'https://untrusted.example.invalid' } },
    );
    await event(socket, 'connect_error');
    expect(socket.connected).toBe(false);
  });
  it('detects externally changed tokenVersion during the periodic check and preserves other sessions', async () => {
    const target = client(
      await jwt.signAsync({ sub: user.id, tokenVersion: 0 }),
    );
    const other = client(
      await jwt.signAsync({ sub: otherUser.id, tokenVersion: 0 }),
    );
    await Promise.all([connected(target), connected(other)]);
    const invalidated = event(target, 'session:invalidated');
    user.tokenVersion++;
    await realtime.checkSessions();
    expect(await invalidated).toEqual({ reason: 'securityChanged' });
    expect(other.connected).toBe(true);
  });
  it('does not treat a transient database error as invalid credentials', async () => {
    db.user.findUnique.mockRejectedValueOnce(
      new Error('temporary persistence outage'),
    );
    const socket = client(
      await jwt.signAsync({ sub: user.id, tokenVersion: 0 }),
    );
    expect(
      (await event<{ data: { code: string } }>(socket, 'connect_error')).data
        .code,
    ).toBe('AUTH_UNAVAILABLE');
  });
  it('emits create/delete/category events and accepts no client-controlled broadcast', async () => {
    const socket = client(
      await jwt.signAsync({ sub: user.id, tokenVersion: 0 }),
    );
    await connected(socket);
    const created = event(socket, 'product:changed');
    await app.get(ProductsService).create(user.id, {
      name: product.name,
      price: '12.00',
      stock: 10,
      categoryId: product.categoryId,
    });
    expect(await created).toMatchObject({
      id: product.id,
      operation: 'created',
    });
    const deleted = event(socket, 'product:changed');
    await app
      .get(ProductsService)
      .remove(product.id, { id: user.id, role: 'OPERATOR' });
    expect(await deleted).toMatchObject({
      id: product.id,
      operation: 'deleted',
    });
    const category = event(socket, 'category:changed');
    realtime.resourceChanged('category', product.categoryId, 'updated');
    expect(await category).toMatchObject({
      id: product.categoryId,
      operation: 'updated',
    });
    const listener = vi.fn();
    socket.on('product:changed', listener);
    socket.emit('product:changed', { id: product.id, operation: 'deleted' });
    socket.emit('join', 'all');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(listener).not.toHaveBeenCalled();
  });
});
