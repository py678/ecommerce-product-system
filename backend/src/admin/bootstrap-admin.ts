import 'dotenv/config';
import { DatabaseService } from '../database/database.service.js';
// Explicit username only; no password or token parameters, and never run automatically.
const username = process.argv[2];
if (!username || process.argv.length !== 3)
  throw new Error('Usage: npm run admin:bootstrap -- <existing-username>');
const db = new DatabaseService();
try {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73510943)`;
    if (
      await tx.user.count({
        where: {
          deletedAt: null,
          roleDefinition: { code: 'ADMIN', enabled: true },
        },
      })
    )
      throw new Error(
        'Administrator already exists; use the account management API.',
      );
    const user = await tx.user.findUnique({
      where: { username, deletedAt: null },
      select: { id: true, role: true },
    });
    if (!user)
      throw new Error('Account not found; register the account first.');
    await tx.user.update({
      where: { id: user.id },
      data: { role: 'ADMIN', tokenVersion: { increment: 1 } },
    });
    await tx.roleAudit.create({
      data: {
        actorId: user.id,
        targetId: user.id,
        fromRole: user.role,
        toRole: 'ADMIN',
      },
    });
  });
  console.log('First administrator assigned; previous sessions revoked.');
} finally {
  await db.$disconnect();
}
