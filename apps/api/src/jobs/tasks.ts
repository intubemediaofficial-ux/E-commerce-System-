import { prisma, transaction } from '../lib/prisma';
import { D } from '../lib/decimal';
import { logger } from '../lib/logger';
import { notify } from '../services/notification.service';
import { releaseReservations } from '../services/inventory.service';

/** Emits LOW_STOCK / OUT_OF_STOCK notifications for every organization. */
export async function lowStockScan(): Promise<number> {
  const rows = await prisma.inventoryStock.findMany({
    include: {
      product: { select: { name: true, sku: true, reorderLevel: true } },
      warehouse: { select: { name: true } },
    },
  });

  let emitted = 0;
  for (const row of rows) {
    const quantity = D(row.quantity);
    const reorder = D(row.product.reorderLevel);
    const type = quantity.lessThanOrEqualTo(0)
      ? 'OUT_OF_STOCK'
      : quantity.lessThanOrEqualTo(reorder)
        ? 'LOW_STOCK'
        : null;
    if (!type) continue;

    const open = await prisma.notification.findFirst({
      where: {
        organizationId: row.organizationId,
        type,
        entityType: 'INVENTORY_STOCK',
        entityId: row.id,
        readAt: null,
      },
      select: { id: true },
    });
    if (open) continue;

    emitted += await notify({
      organizationId: row.organizationId,
      type,
      title: type === 'OUT_OF_STOCK' ? 'Out of stock' : 'Low stock',
      message: `${row.product.name} (${row.product.sku}) at ${row.warehouse.name} is at ${quantity.toFixed(2)} (reorder level ${reorder.toFixed(2)}).`,
      entityType: 'INVENTORY_STOCK',
      entityId: row.id,
      permissions: ['inventory.view'],
    });
  }
  return emitted;
}

/** Notifies about batches that expired or expire within 7 days. */
export async function expiryScan(): Promise<number> {
  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 86_400_000);
  const batches = await prisma.inventoryBatch.findMany({
    where: { quantity: { gt: 0 }, expiryDate: { not: null, lte: in7Days } },
    include: {
      product: { select: { name: true, sku: true } },
      warehouse: { select: { name: true } },
    },
  });

  let emitted = 0;
  for (const batch of batches) {
    const expired = batch.expiryDate !== null && batch.expiryDate <= now;
    const type = expired ? 'EXPIRED' : 'EXPIRING_SOON';
    const open = await prisma.notification.findFirst({
      where: {
        organizationId: batch.organizationId,
        type,
        entityType: 'INVENTORY_BATCH',
        entityId: batch.id,
        readAt: null,
      },
      select: { id: true },
    });
    if (open) continue;

    emitted += await notify({
      organizationId: batch.organizationId,
      type,
      title: expired ? 'Expired stock' : 'Stock expiring soon',
      message: `Batch ${batch.batchNumber} of ${batch.product.name} (${batch.product.sku}) at ${batch.warehouse.name} — ${D(batch.quantity).toFixed(2)} units, expiry ${batch.expiryDate?.toISOString().slice(0, 10)}.`,
      entityType: 'INVENTORY_BATCH',
      entityId: batch.id,
      permissions: ['inventory.view'],
    });
  }
  return emitted;
}

/** Releases reservations whose TTL elapsed so stock becomes sellable again. */
export async function reservationExpiry(): Promise<number> {
  const expired = await prisma.inventoryReservation.findMany({
    where: { status: 'ACTIVE', expiresAt: { not: null, lte: new Date() } },
    select: { orderId: true, organizationId: true },
    distinct: ['orderId'],
  });

  let released = 0;
  for (const reservation of expired) {
    released += await transaction((tx) =>
      releaseReservations(tx, reservation.organizationId, reservation.orderId, 'EXPIRED'),
    );
  }
  if (released > 0) logger.info({ released }, 'Expired reservations released');
  return released;
}

/** Flags organizations whose daily wastage cost exceeds the alert threshold. */
export async function wastageDigest(threshold = 5_000): Promise<number> {
  const since = new Date(Date.now() - 86_400_000);
  const grouped = await prisma.wastage.groupBy({
    by: ['organizationId'],
    where: { createdAt: { gte: since } },
    _sum: { estimatedCost: true },
  });

  let emitted = 0;
  for (const row of grouped) {
    const cost = D(row._sum.estimatedCost ?? 0);
    if (cost.lessThan(threshold)) continue;
    emitted += await notify({
      organizationId: row.organizationId,
      type: 'LARGE_WASTAGE',
      title: 'High wastage in the last 24 hours',
      message: `Recorded wastage cost is ${cost.toFixed(2)} in the last 24 hours.`,
      entityType: 'WASTAGE_DIGEST',
      permissions: ['inventory.view'],
    });
  }
  return emitted;
}
