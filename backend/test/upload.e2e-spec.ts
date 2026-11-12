import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../dist/app.module.js';
import { configureApp } from '../dist/configure-app.js';
import { DatabaseService } from '../dist/database/database.service.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJ1sAAAAASUVORK5CYII=',
  'base64',
);
describe.sequential('Image upload and product cover HTTP API', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let token: string;
  let userId: string;
  let categoryId: string;
  let cover: string;
  const files: string[] = [];
  const prefix = `upload_${randomUUID()}`;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
    db = app.get(DatabaseService);
    const user = await db.user.create({
      data: {
        username: prefix,
        role: 'OPERATOR',
        email: `${prefix}@example.invalid`,
        passwordHash: 'unused-fixture-hash',
      },
    });
    userId = user.id;
    categoryId = (await db.category.create({ data: { name: prefix } })).id;
    token = await app
      .get(JwtService)
      .signAsync({ sub: userId, tokenVersion: 0 });
  });
  afterAll(async () => {
    if (db && userId) {
      await db.product.deleteMany({ where: { userId } });
      await db.category.deleteMany({ where: { id: categoryId } });
      await db.user.delete({ where: { id: userId } });
    }
    await Promise.all(
      files.map((file) =>
        unlink(join(process.cwd(), 'uploads', basename(file))).catch(() => {}),
      ),
    );
    await app?.close();
  });
  function upload(
    bytes = png,
    filename = 'picture.png',
    contentType = 'image/png',
  ) {
    return request(app.getHttpServer())
      .post('/api/upload/image')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', bytes, { filename, contentType });
  }
  it('requires a valid JWT before processing any file', async () => {
    await request(app.getHttpServer())
      .post('/api/upload/image')
      .attach('file', png, 'x.png')
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/upload/image')
      .set('Authorization', 'Bearer invalid')
      .attach('file', png, 'x.png')
      .expect(401);
  });
  it('renames duplicate filenames to unique UUIDs, returns the envelope and serves bytes publicly', async () => {
    for (let i = 0; i < 2; i++) {
      const response = await upload().expect(200);
      const url = response.body.data.url as string;
      files.push(url);
      expect(response.body).toEqual({ code: 0, message: 'ok', data: { url } });
      expect(url).toMatch(/^\/uploads\/[0-9a-f-]{36}\.png$/);
      const image = await request(app.getHttpServer())
        .get(url)
        .expect(200)
        .expect('Content-Type', /image\/png/)
        .expect('X-Content-Type-Options', 'nosniff');
      expect(image.body).toEqual(png);
    }
    expect(files[0]).not.toBe(files[1]);
    cover = files[0];
  });
  it.each(['jpg', 'jpeg', 'webp'])(
    'accepts the allowed %s signature and MIME',
    async (extension) => {
      const bytes =
        extension === 'webp'
          ? Buffer.from(
              'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA',
              'base64',
            )
          : Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9]);
      const response = await upload(
        bytes,
        `picture.${extension}`,
        extension === 'webp' ? 'image/webp' : 'image/jpeg',
      ).expect(200);
      files.push(response.body.data.url);
    },
  );
  it('accepts exactly 5MiB and rejects larger files', async () => {
    const boundary = Buffer.alloc(5 * 1024 * 1024);
    png.copy(boundary);
    const response = await upload(boundary).expect(200);
    files.push(response.body.data.url);
    await upload(Buffer.concat([boundary, Buffer.from([0])])).expect(413);
  });
  it.each([
    ['text.png', 'image/png', Buffer.from('<script>alert(1)</script>')],
    ['picture.svg', 'image/svg+xml', Buffer.from('<svg/>')],
    ['picture.jpg', 'image/jpeg', png],
    ['picture.png', 'application/octet-stream', png],
  ])(
    'rejects spoofed or disallowed file %s (%s)',
    async (name, mime, bytes) => {
      await upload(bytes, name, mime).expect(400);
    },
  );
  it('rejects missing/empty files, unexpected fields and multiple files', async () => {
    await request(app.getHttpServer())
      .post('/api/upload/image')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    await upload(Buffer.alloc(0)).expect(400);
    await request(app.getHttpServer())
      .post('/api/upload/image')
      .set('Authorization', `Bearer ${token}`)
      .attach('other', png, 'x.png')
      .expect(400);
    await upload().attach('file', png, 'another.png').expect(400);
  });
  it('persists cover on create, preserves it when omitted and clears it without deleting the file', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: prefix, price: '10.00', categoryId, coverImage: cover })
      .expect(201);
    expect(created.body.coverImage).toBe(cover);
    const patch = (body: object) =>
      request(app.getHttpServer())
        .patch(`/api/products/${created.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);
    expect(
      (
        await patch({
          stock: 8,
          stockVersion: 0,
          stockReason: '上传测试盘点',
        }).expect(200)
      ).body.coverImage,
    ).toBe(cover);
    expect(
      (
        await patch({ coverImage: 'https://example.com/cover.webp' }).expect(
          200,
        )
      ).body.coverImage,
    ).toBe('https://example.com/cover.webp');
    expect(
      (await patch({ coverImage: '' }).expect(200)).body.coverImage,
    ).toBeNull();
    await request(app.getHttpServer()).get(cover).expect(200);
    expect(
      (
        await request(app.getHttpServer())
          .get(`/api/products/${created.body.id}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200)
      ).body.coverImage,
    ).toBeNull();
  });
  it.each([
    'not-a-url',
    'javascript:alert(1)',
    '//example.com/image.png',
    '/uploads/../../secret',
    null,
    42,
  ])('rejects invalid coverImage %s', async (coverImage) => {
    await request(app.getHttpServer())
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: prefix, price: '1.00', categoryId, coverImage })
      .expect(400);
  });
  it('documents authenticated multipart uploads and optional/nullable cover schemas', async () => {
    const doc = (
      await request(app.getHttpServer()).get('/docs-json').expect(200)
    ).body;
    const upload = doc.paths['/api/upload/image'].post;
    expect(upload.security).toEqual([{ bearer: [] }]);
    expect(
      upload.requestBody.content['multipart/form-data'].schema.properties.file,
    ).toEqual({ type: 'string', format: 'binary' });
    expect(
      upload.responses['200'].content['application/json'].schema.$ref,
    ).toContain('UploadResponseDto');
    expect(doc.components.schemas.CreateProductDto.required).not.toContain(
      'coverImage',
    );
    expect(
      doc.components.schemas.CreateProductDto.properties.coverImage.type,
    ).toBe('string');
    expect(
      doc.components.schemas.ProductResponseDto.properties.coverImage.nullable,
    ).toBe(true);
  });
});
