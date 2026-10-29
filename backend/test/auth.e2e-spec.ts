import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';
import { compare, getRounds } from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../dist/app.module.js';
import { configureApp } from '../dist/configure-app.js';
import { DatabaseService } from '../dist/database/database.service.js';
import { JWT_AUDIENCE, JWT_ISSUER } from '../dist/auth/auth.config.js';

describe.sequential('Authentication HTTP API (real PostgreSQL)', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let jwt: JwtService;
  const prefix = `auth_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const username = `${prefix}_main`;
  const password = 'Test-password-123!';
  const email = `${prefix}@example.invalid`;
  const fixtures = new Set([username]);
  let registration: {
    user: { id: string; username: string; email: string };
    accessToken: string;
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    db = app.get(DatabaseService);
    jwt = app.get(JwtService);
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        username: ` ${username} `,
        email: ` ${email.toUpperCase()} `,
        password,
      })
      .expect(201);
    registration = response.body;
    expect(response.headers['cache-control']).toBe('no-store');
  });

  afterAll(async () => {
    try {
      if (db)
        await db.user.deleteMany({
          where: { username: { in: [...fixtures] } },
        });
    } finally {
      if (app) await app.close();
    }
  });

  it('registers normalized fields, stores BCrypt and omits the password hash', async () => {
    expect(registration.user).toMatchObject({ username, email });
    expect(registration.user).not.toHaveProperty('passwordHash');
    const stored = await db.user.findUniqueOrThrow({ where: { username } });
    expect(stored.passwordHash).not.toBe(password);
    expect(getRounds(stored.passwordHash)).toBe(12);
    expect(await compare(password, stored.passwordHash)).toBe(true);
    const claims = await jwt.verifyAsync(registration.accessToken);
    expect(claims).toMatchObject({
      sub: stored.id,
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
    });
    expect(claims.exp - claims.iat).toBe(3600);
    expect(claims).not.toHaveProperty('passwordHash');
  });

  it('rejects duplicate usernames and normalized email addresses', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username, email: `other-${email}`, password })
      .expect(409);
    const other = `${prefix}_email`;
    fixtures.add(other);
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ username: other, email: email.toUpperCase(), password })
      .expect(409);
  });

  it('enforces uniqueness during simultaneous registration', async () => {
    const raceName = `${prefix}_race`;
    fixtures.add(raceName);
    const register = () =>
      request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          username: raceName,
          email: `${raceName}@example.invalid`,
          password,
        });
    const results = await Promise.all([register(), register()]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(await db.user.count({ where: { username: raceName } })).toBe(1);
  });

  it.each([
    { username: 'a', email: 'bad', password: 'short' },
    { username: 'invalid name', email: 'ok@example.invalid', password },
    { username: 123, email: 'ok@example.invalid', password },
    { username: null, email: [], password },
    { username, email, password: 'a'.repeat(73) },
    { username, email, password: '密'.repeat(25) },
    { username, email, password: ' '.repeat(10) },
    { username, email, password, isAdmin: true },
  ])('rejects invalid or unexpected registration fields %#', async (body) => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(body)
      .expect(400);
    expect(response.body).not.toHaveProperty('password');
  });

  it('logs in and uses the returned token to load the current user', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: ` ${username} `, password })
      .expect(200);
    expect(response.body).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 3600,
    });
    expect(response.body.user).not.toHaveProperty('passwordHash');
    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${response.body.accessToken}`)
      .expect(200);
    expect(me.body).toEqual(response.body.user);
    expect(me.headers['cache-control']).toBe('no-store');
  });

  it('returns the same error for wrong passwords and unknown users', async () => {
    const wrongPassword = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username, password: 'Wrong-password-123!' })
      .expect(401);
    const unknown = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: `${prefix}_missing`, password })
      .expect(401);
    expect(wrongPassword.body).toEqual(unknown.body);
  });

  it('rejects malformed login payloads', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: { value: username }, password })
      .expect(400);
  });

  it('preserves password spaces rather than silently trimming them', async () => {
    const spacedName = `${prefix}_spaces`;
    fixtures.add(spacedName);
    const spacedPassword = ` ${password} `;
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        username: spacedName,
        email: `${spacedName}@example.invalid`,
        password: spacedPassword,
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: spacedName, password })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: spacedName, password: spacedPassword })
      .expect(200);
  });

  it('rejects missing, malformed, expired, tampered and wrongly scoped tokens', async () => {
    await request(app.getHttpServer()).get('/api/auth/me').expect(401);
    const tokens = [
      'not-a-jwt',
      `${registration.accessToken}.tampered`,
      await jwt.signAsync({ sub: registration.user.id }, { expiresIn: -1 }),
      await jwt.signAsync(
        { sub: registration.user.id },
        { audience: 'other-application' },
      ),
      await jwt.signAsync(
        { sub: registration.user.id },
        { issuer: 'other-issuer' },
      ),
      await jwt.signAsync({ sub: 'invalid-user-id' }),
      await jwt.signAsync(
        { sub: registration.user.id },
        { secret: 'a-different-secret-that-is-long-enough' },
      ),
    ];
    for (const token of tokens) {
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    }
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Basic ${registration.accessToken}`)
      .expect(401);
  });

  it('rejects an otherwise valid token for a deleted user', async () => {
    const token = await jwt.signAsync({ sub: randomUUID() });
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('publishes Swagger schemas for authentication and bearer authorization', async () => {
    const response = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    expect(response.body.paths).toHaveProperty('/api/auth/register');
    expect(response.body.paths).toHaveProperty('/api/auth/login');
    expect(response.body.paths['/api/auth/me'].get.security).toEqual([
      { bearer: [] },
    ]);
    expect(
      response.body.components.schemas.UserResponseDto.properties,
    ).not.toHaveProperty('passwordHash');
  });
});

describe('Authentication rate limits', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('limits registration to 5 and login to 10 requests per minute per IP and route', async () => {
    // Malformed requests are also counted, without creating fixture accounts.
    for (let index = 0; index < 5; index++) {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({})
        .expect(400);
    }
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({})
      .expect(429);
    for (let index = 0; index < 10; index++) {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({})
        .expect(400);
    }
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({})
      .expect(429);
    expect(response.headers['retry-after']).toBeDefined();
  });
});
