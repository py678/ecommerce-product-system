import { DatabaseService } from '../dist/database/database.service.js';

// Only accept a complete random test prefix, never an empty or arbitrary filter.
const prefix = process.argv[2];
if (!prefix || !/^ui_[0-9a-f]{16}$/.test(prefix)) {
  throw new Error(
    'Expected a browser test prefix: ui_ followed by 16 hex characters.',
  );
}
const database = new DatabaseService();
try {
  await database.$connect();
  await database.$transaction(async (tx) => {
    const users = await tx.user.findMany({
      where: { username: { startsWith: `${prefix}_` } },
      select: { id: true },
    });
    const ids = users.map((user) => user.id);
    await tx.product.deleteMany({ where: { userId: { in: ids } } });
    await tx.category.deleteMany({
      where: { name: { startsWith: `${prefix}_` } },
    });
    await tx.user.deleteMany({ where: { id: { in: ids } } });
  });
} finally {
  await database.$disconnect();
}
