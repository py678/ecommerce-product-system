import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error('DATABASE_URL is required for database verification.');

test('Prisma relations, Decimal values and CRUD work without leaving fixture records', async () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  const id = randomUUID();
  const rollback = new Error('ROLLBACK_VERIFICATION_FIXTURE');
  try {
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id,
            username: `verify-${id}`,
            email: `${id}@example.invalid`,
            passwordHash:
              '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
          },
        });
        const category = await tx.category.create({
          data: { name: 'Verification category' },
        });
        const product = await tx.product.create({
          data: {
            name: 'Verification product',
            userId: user.id,
            categoryId: category.id,
            price: '19.90',
            stock: 3,
          },
          include: { category: true, user: true },
        });
        assert.equal(product.price.toFixed(2), '19.90');
        assert.equal(product.user.id, user.id);
        assert.equal(product.category.id, category.id);
        const updated = await tx.product.update({
          where: { id: product.id },
          data: { stock: 2, price: '9.99' },
        });
        assert.equal(updated.stock, 2);
        assert.equal(updated.price.toFixed(2), '9.99');
        await tx.product.delete({ where: { id: product.id } });
        assert.equal(await tx.product.count({ where: { id: product.id } }), 0);
        throw rollback;
      }),
      (error: unknown) => error === rollback,
    );
    assert.equal(await prisma.user.count({ where: { id } }), 0);
  } finally {
    await prisma.$disconnect();
  }
});

test('PostgreSQL enforces uniqueness, foreign keys, nonnegative values and delete restrictions', async () => {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    const id = randomUUID();
    const categoryId = randomUUID();
    await client.query(
      'INSERT INTO users (id, username, email, password_hash) VALUES ($1,$2,$3,$4)',
      [
        id,
        `verify-${id}`,
        `${id}@example.invalid`,
        '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
      ],
    );
    await client.query('INSERT INTO categories (id, name) VALUES ($1,$2)', [
      categoryId,
      'Verification category',
    ]);
    const insert =
      'INSERT INTO products (user_id, category_id, name, price, stock) VALUES ($1,$2,$3,$4,$5)';
    const cases: Array<[string, string, unknown[], string]> = [
      [
        'duplicate username',
        'INSERT INTO users (username,email,password_hash) VALUES ($1,$2,$3)',
        [`verify-${id}`, `other-${id}@example.invalid`, 'unused'],
        '23505',
      ],
      [
        'duplicate email',
        'INSERT INTO users (username,email,password_hash) VALUES ($1,$2,$3)',
        [`other-${id}`, `${id}@example.invalid`, 'unused'],
        '23505',
      ],
      [
        'negative price',
        insert,
        [id, categoryId, 'Invalid', '-0.01', 0],
        '23514',
      ],
      ['NaN price', insert, [id, categoryId, 'Invalid', 'NaN', 0], '23514'],
      [
        'negative stock',
        insert,
        [id, categoryId, 'Invalid', '0.00', -1],
        '23514',
      ],
      [
        'unknown user',
        insert,
        [randomUUID(), categoryId, 'Invalid', '1.00', 0],
        '23503',
      ],
      [
        'unknown category',
        insert,
        [id, randomUUID(), 'Invalid', '1.00', 0],
        '23503',
      ],
      [
        'blank product name',
        insert,
        [id, categoryId, '   ', '1.00', 0],
        '23514',
      ],
    ];
    await client.query(insert, [
      id,
      categoryId,
      'Valid free product',
      '0.00',
      0,
    ]);
    cases.push(
      [
        'referenced category deletion',
        'DELETE FROM categories WHERE id=$1',
        [categoryId],
        '23001',
      ],
      [
        'referenced user deletion',
        'DELETE FROM users WHERE id=$1',
        [id],
        '23001',
      ],
    );
    for (const [label, sql, params, expectedCode] of cases) {
      await client.query('SAVEPOINT constraint_check');
      await assert.rejects(
        client.query(sql, params),
        (error: unknown) => {
          assert.equal((error as { code?: string }).code, expectedCode, label);
          return true;
        },
        label,
      );
      await client.query('ROLLBACK TO SAVEPOINT constraint_check');
    }
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
