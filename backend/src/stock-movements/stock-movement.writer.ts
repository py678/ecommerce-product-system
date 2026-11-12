import type { Prisma, StockMovementType } from '../generated/prisma/client.js';

/** Called only inside the transaction that changed stock; snapshots survive deletion. */
export async function writeStockMovement(
  tx: Prisma.TransactionClient,
  input: {
    product: {
      id: string;
      name: string;
      userId: string;
      stock: number;
      stockVersion: number;
    };
    beforeStock: number;
    type: StockMovementType;
    actorId: string;
    actorName: string;
    reason: string;
    orderId?: string;
    orderNo?: string;
  },
) {
  const p = input.product;
  return tx.stockMovement.create({
    data: {
      productId: p.id,
      productName: p.name,
      ownerId: p.userId,
      type: input.type,
      beforeStock: input.beforeStock,
      quantityChange: p.stock - input.beforeStock,
      afterStock: p.stock,
      stockVersion: p.stockVersion,
      actorId: input.actorId,
      actorName: input.actorName,
      reason: input.reason,
      orderId: input.orderId,
      orderNo: input.orderNo,
      operationKey: `${input.type}:${input.orderId ?? p.id}:${p.id}:${p.stockVersion}`,
    },
  });
}
