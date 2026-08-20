import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, transaction } from '../../lib/prisma';
import { created, ok, pageMeta } from '../../lib/http';
import { badRequest, invalidState, notFound } from '../../lib/errors';
import { D } from '../../lib/decimal';
import { paginationSchema, positiveDecimal, skipTake, uuidParam } from '../../lib/query';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../middleware/asyncHandler';
import { idempotency } from '../../middleware/idempotency';
import { orgId, requirePermission, userId } from '../../middleware/auth';
import { auditFromRequest } from '../../services/audit.service';
import { consumeStock, receiveStock } from '../../services/inventory.service';
import { nextDocumentNumber } from '../../services/numbering.service';
import { notifyAffectedStock } from './inventory.routes';

const router = Router();

const createSchema = z
  .object({
    sourceWarehouseId: z.string().uuid(),
    destinationWarehouseId: z.string().uuid(),
    notes: z.string().trim().max(1000).optional(),
    submit: z.boolean().default(true),
    items: z
      .array(z.object({ productId: z.string().uuid(), quantity: positiveDecimal }))
      .min(1, 'At least one item is required'),
  })
  .refine((v) => v.sourceWarehouseId !== v.destinationWarehouseId, {
    message: 'Source and destination warehouses must differ',
    path: ['destinationWarehouseId'],
  });

router.get(
  '/',
  requirePermission('inventory.view'),
  validate({
    query: paginationSchema.extend({
      status: z.string().optional(),
      sourceWarehouseId: z.string().uuid().optional(),
      destinationWarehouseId: z.string().uuid().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof paginationSchema> & {
      status?: string;
      sourceWarehouseId?: string;
      destinationWarehouseId?: string;
    };
    const where: Prisma.StockTransferWhereInput = {
      organizationId: orgId(req),
      ...(q.status ? { status: q.status as Prisma.EnumStockTransferStatusFilter['equals'] } : {}),
      ...(q.sourceWarehouseId ? { sourceWarehouseId: q.sourceWarehouseId } : {}),
      ...(q.destinationWarehouseId ? { destinationWarehouseId: q.destinationWarehouseId } : {}),
      ...(q.from || q.to ? { createdAt: { gte: q.from, lte: q.to } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.stockTransfer.findMany({
        where,
        ...skipTake(q),
        orderBy: { createdAt: q.sortDir },
        include: {
          sourceWarehouse: { select: { id: true, name: true } },
          destinationWarehouse: { select: { id: true, name: true } },
          items: { include: { product: { select: { id: true, name: true, sku: true } } } },
        },
      }),
      prisma.stockTransfer.count({ where }),
    ]);
    return ok(res, rows, pageMeta(q.page, q.perPage, total));
  }),
);

router.get(
  '/:id',
  requirePermission('inventory.view'),
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => {
    const transfer = await prisma.stockTransfer.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
      include: {
        sourceWarehouse: true,
        destinationWarehouse: true,
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
      },
    });
    if (!transfer) throw notFound('TRANSFER_NOT_FOUND', 'Stock transfer not found.');
    return ok(res, transfer);
  }),
);

router.post(
  '/',
  requirePermission('inventory.transfer'),
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const body = req.body as z.infer<typeof createSchema>;

    const warehouses = await prisma.warehouse.findMany({
      where: { organizationId, id: { in: [body.sourceWarehouseId, body.destinationWarehouseId] } },
      select: { id: true },
    });
    if (warehouses.length !== 2) {
      throw notFound('WAREHOUSE_NOT_FOUND', 'Source or destination warehouse not found.');
    }

    const transfer = await transaction(async (tx) => {
      const stockRows = await tx.inventoryStock.findMany({
        where: {
          organizationId,
          warehouseId: body.sourceWarehouseId,
          productId: { in: body.items.map((i) => i.productId) },
        },
        select: { productId: true, averageCost: true },
      });
      const costOf = new Map(stockRows.map((r) => [r.productId, r.averageCost]));

      return tx.stockTransfer.create({
        data: {
          organizationId,
          transferNumber: await nextDocumentNumber(organizationId, 'TRF', tx),
          sourceWarehouseId: body.sourceWarehouseId,
          destinationWarehouseId: body.destinationWarehouseId,
          notes: body.notes,
          status: body.submit ? 'REQUESTED' : 'DRAFT',
          requestedBy: userId(req),
          items: {
            create: body.items.map((item) => ({
              productId: item.productId,
              quantity: String(item.quantity),
              unitCost: D(costOf.get(item.productId) ?? 0).toFixed(4),
            })),
          },
        },
        include: { items: true },
      });
    });

    await auditFromRequest(req, {
      action: 'STOCK_TRANSFER_CREATED',
      module: 'inventory',
      entityType: 'StockTransfer',
      entityId: transfer.id,
      newValue: transfer,
    });
    return created(res, transfer);
  }),
);

router.post(
  '/:id/approve',
  requirePermission('inventory.transfer.approve'),
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => {
    const transfer = await prisma.stockTransfer.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
    });
    if (!transfer) throw notFound('TRANSFER_NOT_FOUND', 'Stock transfer not found.');
    if (transfer.status !== 'REQUESTED' && transfer.status !== 'DRAFT') {
      throw invalidState('Only draft or requested transfers can be approved.');
    }
    const updated = await prisma.stockTransfer.update({
      where: { id: transfer.id },
      data: { status: 'APPROVED', approvedBy: userId(req) },
      include: { items: true },
    });
    await auditFromRequest(req, {
      action: 'STOCK_TRANSFER_APPROVED',
      module: 'inventory',
      entityType: 'StockTransfer',
      entityId: updated.id,
      oldValue: transfer,
      newValue: updated,
    });
    return ok(res, updated);
  }),
);

/** Dispatch deducts stock from the source warehouse (OUT ledger only). */
router.post(
  '/:id/dispatch',
  requirePermission('inventory.transfer'),
  validate({ params: uuidParam }),
  idempotency,
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const performedBy = userId(req);

    const updated = await transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findFirst({
        where: { id: req.params.id, organizationId },
        include: { items: true },
      });
      if (!transfer) throw notFound('TRANSFER_NOT_FOUND', 'Stock transfer not found.');
      if (transfer.status !== 'APPROVED') {
        throw invalidState('Only approved transfers can be dispatched.');
      }

      for (const item of transfer.items) {
        const { totalCost } = await consumeStock(tx, {
          organizationId,
          productId: item.productId,
          warehouseId: transfer.sourceWarehouseId,
          transactionType: 'STOCK_TRANSFER_OUT',
          quantity: item.quantity,
          referenceType: 'STOCK_TRANSFER',
          referenceId: transfer.id,
          performedBy,
          notes: `Transfer ${transfer.transferNumber} dispatch`,
        });
        await tx.stockTransferItem.update({
          where: { id: item.id },
          data: { unitCost: totalCost.dividedBy(D(item.quantity)).toDecimalPlaces(4) },
        });
      }

      return tx.stockTransfer.update({
        where: { id: transfer.id },
        data: { status: 'DISPATCHED', dispatchedAt: new Date() },
        include: { items: true },
      });
    });

    await auditFromRequest(req, {
      action: 'STOCK_TRANSFER_DISPATCHED',
      module: 'inventory',
      entityType: 'StockTransfer',
      entityId: updated.id,
      newValue: updated,
    });
    await notifyAffectedStock(
      organizationId,
      updated.sourceWarehouseId,
      updated.items.map((i) => i.productId),
    );
    return ok(res, updated);
  }),
);

const receiveSchema = z.object({
  items: z
    .array(z.object({ itemId: z.string().uuid(), quantity: positiveDecimal }))
    .optional(),
});

/** Receiving credits the destination warehouse (IN ledger only). Supports partial receipts. */
router.post(
  '/:id/receive',
  requirePermission('inventory.transfer'),
  validate({ params: uuidParam, body: receiveSchema }),
  idempotency,
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const performedBy = userId(req);
    const body = req.body as z.infer<typeof receiveSchema>;

    const updated = await transaction(async (tx) => {
      const transfer = await tx.stockTransfer.findFirst({
        where: { id: req.params.id, organizationId },
        include: { items: true },
      });
      if (!transfer) throw notFound('TRANSFER_NOT_FOUND', 'Stock transfer not found.');
      if (transfer.status !== 'DISPATCHED' && transfer.status !== 'RECEIVED') {
        throw invalidState('Only dispatched transfers can be received.');
      }

      const requested =
        body.items ??
        transfer.items.map((item) => ({
          itemId: item.id,
          quantity: D(item.quantity).minus(D(item.receivedQuantity)).toFixed(4),
        }));

      for (const line of requested) {
        const item = transfer.items.find((i) => i.id === line.itemId);
        if (!item) throw badRequest('VALIDATION_ERROR', 'Unknown transfer item.');
        const outstanding = D(item.quantity).minus(D(item.receivedQuantity));
        const qty = D(line.quantity);
        if (qty.lessThanOrEqualTo(0)) continue;
        if (qty.greaterThan(outstanding)) {
          throw badRequest(
            'INVALID_QUANTITY',
            'Received quantity exceeds the outstanding transfer quantity.',
          );
        }
        await receiveStock(tx, {
          organizationId,
          productId: item.productId,
          warehouseId: transfer.destinationWarehouseId,
          transactionType: 'STOCK_TRANSFER_IN',
          quantityChange: qty,
          unitCost: item.unitCost,
          referenceType: 'STOCK_TRANSFER',
          referenceId: transfer.id,
          performedBy,
          notes: `Transfer ${transfer.transferNumber} receipt`,
        });
        await tx.stockTransferItem.update({
          where: { id: item.id },
          data: { receivedQuantity: D(item.receivedQuantity).plus(qty).toFixed(4) },
        });
      }

      const refreshed = await tx.stockTransfer.findUniqueOrThrow({
        where: { id: transfer.id },
        include: { items: true },
      });
      const complete = refreshed.items.every((i) =>
        D(i.receivedQuantity).greaterThanOrEqualTo(D(i.quantity)),
      );
      return tx.stockTransfer.update({
        where: { id: refreshed.id },
        data: {
          status: complete ? 'COMPLETED' : 'RECEIVED',
          receivedAt: new Date(),
        },
        include: { items: true },
      });
    });

    await auditFromRequest(req, {
      action: 'STOCK_TRANSFER_RECEIVED',
      module: 'inventory',
      entityType: 'StockTransfer',
      entityId: updated.id,
      newValue: updated,
    });
    await notifyAffectedStock(
      organizationId,
      updated.destinationWarehouseId,
      updated.items.map((i) => i.productId),
    );
    return ok(res, updated);
  }),
);

router.post(
  '/:id/cancel',
  requirePermission('inventory.transfer'),
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => {
    const transfer = await prisma.stockTransfer.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
    });
    if (!transfer) throw notFound('TRANSFER_NOT_FOUND', 'Stock transfer not found.');
    if (!['DRAFT', 'REQUESTED', 'APPROVED'].includes(transfer.status)) {
      throw invalidState('Dispatched transfers cannot be cancelled.');
    }
    const updated = await prisma.stockTransfer.update({
      where: { id: transfer.id },
      data: { status: 'CANCELLED' },
    });
    await auditFromRequest(req, {
      action: 'STOCK_TRANSFER_CANCELLED',
      module: 'inventory',
      entityType: 'StockTransfer',
      entityId: updated.id,
      oldValue: transfer,
      newValue: updated,
    });
    return ok(res, updated);
  }),
);

export default router;
