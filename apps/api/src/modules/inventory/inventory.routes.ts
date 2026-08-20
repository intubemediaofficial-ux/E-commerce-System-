import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, transaction } from '../../lib/prisma';
import { created, ok, pageMeta } from '../../lib/http';
import { badRequest, invalidState, notFound } from '../../lib/errors';
import { D, ZERO } from '../../lib/decimal';
import { orderBy, paginationSchema, positiveDecimal, skipTake } from '../../lib/query';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../middleware/asyncHandler';
import { idempotency } from '../../middleware/idempotency';
import { orgId, requirePermission, userId } from '../../middleware/auth';
import { auditFromRequest } from '../../services/audit.service';
import { applyMovement, consumeStock, getSettings } from '../../services/inventory.service';
import { checkStockThresholds } from '../../services/notification.service';
import { nextDocumentNumber } from '../../services/numbering.service';

const router = Router();

export type StockStatus = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

export function stockStatus(quantity: Prisma.Decimal, reorderLevel: Prisma.Decimal): StockStatus {
  if (D(quantity).lessThanOrEqualTo(0)) return 'OUT_OF_STOCK';
  if (D(quantity).lessThanOrEqualTo(D(reorderLevel))) return 'LOW_STOCK';
  return 'IN_STOCK';
}

const listQuery = paginationSchema.extend({
  warehouseId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  status: z.enum(['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK']).optional(),
});

router.get(
  '/',
  requirePermission('inventory.view'),
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof listQuery>;
    const where: Prisma.InventoryStockWhereInput = {
      organizationId: orgId(req),
      ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
      ...(q.productId ? { productId: q.productId } : {}),
      ...(q.categoryId ? { product: { categoryId: q.categoryId } } : {}),
      ...(q.search
        ? {
            product: {
              OR: [
                { name: { contains: q.search, mode: 'insensitive' } },
                { sku: { contains: q.search, mode: 'insensitive' } },
                { barcode: { contains: q.search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
      ...(q.status === 'OUT_OF_STOCK' ? { quantity: { lte: 0 } } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.inventoryStock.findMany({
        where,
        ...skipTake(q),
        orderBy: orderBy(q, ['quantity', 'updatedAt', 'averageCost'], 'updatedAt'),
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              reorderLevel: true,
              isPerishable: true,
              unit: { select: { code: true } },
            },
          },
          warehouse: { select: { id: true, name: true, type: true } },
          variant: { select: { id: true, name: true, sku: true } },
        },
      }),
      prisma.inventoryStock.count({ where }),
    ]);

    const data = rows
      .map((row) => ({
        ...row,
        availableQuantity: D(row.quantity).minus(D(row.reservedQuantity)).toFixed(4),
        stockStatus: stockStatus(row.quantity, row.product.reorderLevel),
        stockValue: D(row.quantity).times(D(row.averageCost)).toFixed(4),
      }))
      .filter((row) => (q.status && q.status !== 'OUT_OF_STOCK' ? row.stockStatus === q.status : true));

    return ok(res, data, pageMeta(q.page, q.perPage, total));
  }),
);

router.get(
  '/summary',
  requirePermission('inventory.view'),
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const rows = await prisma.inventoryStock.findMany({
      where: { organizationId },
      select: {
        quantity: true,
        averageCost: true,
        reservedQuantity: true,
        product: { select: { reorderLevel: true } },
      },
    });
    let totalValue = ZERO;
    let reserved = ZERO;
    let low = 0;
    let out = 0;
    for (const row of rows) {
      totalValue = totalValue.plus(D(row.quantity).times(D(row.averageCost)));
      reserved = reserved.plus(D(row.reservedQuantity));
      const status = stockStatus(row.quantity, row.product.reorderLevel);
      if (status === 'LOW_STOCK') low += 1;
      if (status === 'OUT_OF_STOCK') out += 1;
    }
    return ok(res, {
      stockRows: rows.length,
      totalInventoryValue: totalValue.toFixed(2),
      reservedQuantity: reserved.toFixed(4),
      lowStockCount: low,
      outOfStockCount: out,
    });
  }),
);

router.get(
  '/ledger',
  requirePermission('inventory.view'),
  validate({
    query: paginationSchema.extend({
      productId: z.string().uuid().optional(),
      warehouseId: z.string().uuid().optional(),
      transactionType: z.string().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof paginationSchema> & {
      productId?: string;
      warehouseId?: string;
      transactionType?: string;
    };
    const where: Prisma.InventoryLedgerWhereInput = {
      organizationId: orgId(req),
      ...(q.productId ? { productId: q.productId } : {}),
      ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
      ...(q.transactionType
        ? { transactionType: q.transactionType as Prisma.EnumTransactionTypeFilter['equals'] }
        : {}),
      ...(q.from || q.to ? { createdAt: { gte: q.from, lte: q.to } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.inventoryLedger.findMany({
        where,
        ...skipTake(q),
        orderBy: { createdAt: q.sortDir },
        include: {
          product: { select: { id: true, name: true, sku: true } },
          warehouse: { select: { id: true, name: true } },
          batch: { select: { id: true, batchNumber: true, expiryDate: true } },
          user: { select: { id: true, name: true } },
        },
      }),
      prisma.inventoryLedger.count({ where }),
    ]);
    return ok(res, rows, pageMeta(q.page, q.perPage, total));
  }),
);

// -------------------------------------------------------------- adjustment ---

const adjustSchema = z.object({
  warehouseId: z.string().uuid(),
  reason: z.enum([
    'PHYSICAL_COUNT',
    'DAMAGE',
    'EXPIRED',
    'MISSING',
    'FOUND',
    'DATA_CORRECTION',
    'OPENING_STOCK',
  ]),
  notes: z.string().trim().max(1000).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantityChange: z
          .union([z.number(), z.string()])
          .refine((v) => Number(v) !== 0 && !Number.isNaN(Number(v)), {
            message: 'quantityChange must be a non-zero number',
          }),
        unitCost: z.union([z.number(), z.string()]).optional(),
        notes: z.string().trim().max(500).optional(),
      }),
    )
    .min(1, 'At least one item is required'),
});

router.post(
  '/adjust',
  requirePermission('inventory.adjust'),
  validate({ body: adjustSchema }),
  idempotency,
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const performedBy = userId(req);
    const body = req.body as z.infer<typeof adjustSchema>;

    const result = await transaction(async (tx) => {
      const settings = await getSettings(tx, organizationId);
      const warehouse = await tx.warehouse.findFirst({
        where: { id: body.warehouseId, organizationId },
        select: { id: true },
      });
      if (!warehouse) throw notFound('WAREHOUSE_NOT_FOUND', 'Warehouse not found.');

      const products = await tx.product.findMany({
        where: { organizationId, id: { in: body.items.map((i) => i.productId) } },
        select: { id: true },
      });
      if (products.length !== new Set(body.items.map((i) => i.productId)).size) {
        throw badRequest('PRODUCT_NOT_FOUND', 'One or more products do not exist.');
      }

      let totalValue = ZERO;
      const resolved: { productId: string; quantityChange: string; unitCost: string; notes?: string }[] =
        [];
      for (const item of body.items) {
        const stock = await tx.inventoryStock.findFirst({
          where: { organizationId, productId: item.productId, warehouseId: warehouse.id },
          select: { averageCost: true },
        });
        const unitCost = item.unitCost !== undefined ? D(item.unitCost) : D(stock?.averageCost ?? 0);
        totalValue = totalValue.plus(unitCost.times(D(item.quantityChange).abs()));
        resolved.push({
          productId: item.productId,
          quantityChange: String(item.quantityChange),
          unitCost: unitCost.toFixed(4),
          notes: item.notes,
        });
      }

      const requiresApproval = totalValue.greaterThan(D(settings.adjustmentApprovalValue));
      const adjustment = await tx.stockAdjustment.create({
        data: {
          organizationId,
          adjustmentNumber: await nextDocumentNumber(organizationId, 'ADJ', tx),
          warehouseId: warehouse.id,
          reason: body.reason,
          notes: body.notes,
          totalValue,
          performedBy,
          status: requiresApproval ? 'PENDING_APPROVAL' : 'APPROVED',
          appliedAt: requiresApproval ? null : new Date(),
          items: { create: resolved },
        },
        include: { items: true },
      });

      if (!requiresApproval) {
        for (const item of adjustment.items) {
          await applyMovement(tx, {
            organizationId,
            productId: item.productId,
            warehouseId: warehouse.id,
            transactionType: D(item.quantityChange).greaterThan(0) ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
            quantityChange: item.quantityChange,
            unitCost: item.unitCost,
            referenceType: 'STOCK_ADJUSTMENT',
            referenceId: adjustment.id,
            notes: `${body.reason}${item.notes ? `: ${item.notes}` : ''}`,
            performedBy,
            settings,
          });
        }
      }

      return { adjustment, requiresApproval };
    });

    await auditFromRequest(req, {
      action: result.requiresApproval ? 'STOCK_ADJUSTMENT_SUBMITTED' : 'STOCK_ADJUSTED',
      module: 'inventory',
      entityType: 'StockAdjustment',
      entityId: result.adjustment.id,
      newValue: result.adjustment,
    });

    await notifyAffectedStock(organizationId, body.warehouseId, body.items.map((i) => i.productId));
    return created(res, result.adjustment);
  }),
);

router.post(
  '/adjustments/:id/approve',
  requirePermission('inventory.adjust'),
  validate({ params: z.object({ id: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const approvedBy = userId(req);

    const adjustment = await transaction(async (tx) => {
      const existing = await tx.stockAdjustment.findFirst({
        where: { id: req.params.id, organizationId },
        include: { items: true },
      });
      if (!existing) throw notFound('NOT_FOUND', 'Stock adjustment not found.');
      if (existing.status !== 'PENDING_APPROVAL') {
        throw invalidState('Only pending adjustments can be approved.');
      }
      const settings = await getSettings(tx, organizationId);
      for (const item of existing.items) {
        await applyMovement(tx, {
          organizationId,
          productId: item.productId,
          warehouseId: existing.warehouseId,
          transactionType: D(item.quantityChange).greaterThan(0) ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
          quantityChange: item.quantityChange,
          unitCost: item.unitCost,
          referenceType: 'STOCK_ADJUSTMENT',
          referenceId: existing.id,
          notes: `${existing.reason} (approved)`,
          performedBy: approvedBy,
          settings,
        });
      }
      return tx.stockAdjustment.update({
        where: { id: existing.id },
        data: { status: 'APPROVED', approvedBy, appliedAt: new Date() },
        include: { items: true },
      });
    });

    await auditFromRequest(req, {
      action: 'STOCK_ADJUSTMENT_APPROVED',
      module: 'inventory',
      entityType: 'StockAdjustment',
      entityId: adjustment.id,
      newValue: adjustment,
    });
    await notifyAffectedStock(
      organizationId,
      adjustment.warehouseId,
      adjustment.items.map((i) => i.productId),
    );
    return ok(res, adjustment);
  }),
);

router.get(
  '/adjustments/list',
  requirePermission('inventory.view'),
  validate({ query: paginationSchema.extend({ status: z.string().optional() }) }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof paginationSchema> & { status?: string };
    const where: Prisma.StockAdjustmentWhereInput = {
      organizationId: orgId(req),
      ...(q.status ? { status: q.status as Prisma.EnumAdjustmentStatusFilter['equals'] } : {}),
      ...(q.from || q.to ? { createdAt: { gte: q.from, lte: q.to } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.stockAdjustment.findMany({
        where,
        ...skipTake(q),
        orderBy: { createdAt: q.sortDir },
        include: {
          warehouse: { select: { id: true, name: true } },
          items: { include: { product: { select: { id: true, name: true, sku: true } } } },
        },
      }),
      prisma.stockAdjustment.count({ where }),
    ]);
    return ok(res, rows, pageMeta(q.page, q.perPage, total));
  }),
);

// ----------------------------------------------------------------- wastage ---

const wastageSchema = z.object({
  productId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  quantity: positiveDecimal,
  reason: z.enum([
    'SPOILAGE',
    'EXPIRED',
    'BURNT_FOOD',
    'DAMAGED',
    'PREPARATION_WASTE',
    'CUSTOMER_RETURN',
    'STORAGE_LOSS',
    'OTHER',
  ]),
  notes: z.string().trim().max(1000).optional(),
});

router.post(
  '/wastage',
  requirePermission('inventory.wastage'),
  validate({ body: wastageSchema }),
  idempotency,
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const recordedBy = userId(req);
    const body = req.body as z.infer<typeof wastageSchema>;

    const wastage = await transaction(async (tx) => {
      const { totalCost } = await consumeStock(tx, {
        organizationId,
        productId: body.productId,
        warehouseId: body.warehouseId,
        transactionType: body.reason === 'EXPIRED' ? 'EXPIRY' : 'WASTAGE',
        quantity: body.quantity,
        referenceType: 'WASTAGE',
        performedBy: recordedBy,
        notes: `${body.reason}${body.notes ? `: ${body.notes}` : ''}`,
      });
      return tx.wastage.create({
        data: {
          organizationId,
          productId: body.productId,
          warehouseId: body.warehouseId,
          quantity: String(body.quantity),
          reason: body.reason,
          estimatedCost: totalCost,
          notes: body.notes,
          recordedBy,
        },
      });
    });

    await auditFromRequest(req, {
      action: 'WASTAGE_RECORDED',
      module: 'inventory',
      entityType: 'Wastage',
      entityId: wastage.id,
      newValue: wastage,
    });
    await notifyAffectedStock(organizationId, body.warehouseId, [body.productId]);
    return created(res, wastage);
  }),
);

router.get(
  '/wastage/list',
  requirePermission('inventory.view'),
  validate({
    query: paginationSchema.extend({
      warehouseId: z.string().uuid().optional(),
      productId: z.string().uuid().optional(),
      reason: z.string().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof paginationSchema> & {
      warehouseId?: string;
      productId?: string;
      reason?: string;
    };
    const where: Prisma.WastageWhereInput = {
      organizationId: orgId(req),
      ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
      ...(q.productId ? { productId: q.productId } : {}),
      ...(q.reason ? { reason: q.reason as Prisma.EnumWastageReasonFilter['equals'] } : {}),
      ...(q.from || q.to ? { createdAt: { gte: q.from, lte: q.to } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.wastage.findMany({
        where,
        ...skipTake(q),
        orderBy: { createdAt: q.sortDir },
        include: {
          product: { select: { id: true, name: true, sku: true } },
          warehouse: { select: { id: true, name: true } },
        },
      }),
      prisma.wastage.count({ where }),
    ]);
    return ok(res, rows, pageMeta(q.page, q.perPage, total));
  }),
);

// ----------------------------------------------------------------- batches ---

router.get(
  '/batches/list',
  requirePermission('inventory.view'),
  validate({
    query: paginationSchema.extend({
      warehouseId: z.string().uuid().optional(),
      productId: z.string().uuid().optional(),
      expiringInDays: z.coerce.number().int().min(0).max(3650).optional(),
      expired: z.coerce.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof paginationSchema> & {
      warehouseId?: string;
      productId?: string;
      expiringInDays?: number;
      expired?: boolean;
    };
    const now = new Date();
    const where: Prisma.InventoryBatchWhereInput = {
      organizationId: orgId(req),
      quantity: { gt: 0 },
      ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
      ...(q.productId ? { productId: q.productId } : {}),
      ...(q.expired ? { expiryDate: { lt: now } } : {}),
      ...(q.expiringInDays !== undefined
        ? {
            expiryDate: {
              gte: now,
              lte: new Date(now.getTime() + q.expiringInDays * 86_400_000),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.inventoryBatch.findMany({
        where,
        ...skipTake(q),
        orderBy: { expiryDate: 'asc' },
        include: {
          product: { select: { id: true, name: true, sku: true } },
          warehouse: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
        },
      }),
      prisma.inventoryBatch.count({ where }),
    ]);
    return ok(res, rows, pageMeta(q.page, q.perPage, total));
  }),
);

router.get(
  '/expiry/summary',
  requirePermission('inventory.view'),
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const now = new Date();
    const windows = [0, 7, 15, 30];
    const buckets: Record<string, number> = {};

    const expired = await prisma.inventoryBatch.count({
      where: { organizationId, quantity: { gt: 0 }, expiryDate: { lt: now } },
    });
    buckets.expired = expired;

    for (const days of windows.slice(1)) {
      buckets[`in${days}Days`] = await prisma.inventoryBatch.count({
        where: {
          organizationId,
          quantity: { gt: 0 },
          expiryDate: { gte: now, lte: new Date(now.getTime() + days * 86_400_000) },
        },
      });
    }
    buckets.expiringToday = await prisma.inventoryBatch.count({
      where: {
        organizationId,
        quantity: { gt: 0 },
        expiryDate: { gte: now, lte: new Date(now.getTime() + 86_400_000) },
      },
    });

    return ok(res, buckets);
  }),
);

// Registered last so it never shadows the sub-resource routes above.
router.get(
  '/:productId',
  requirePermission('inventory.view'),
  validate({ params: z.object({ productId: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const product = await prisma.product.findFirst({
      where: { id: req.params.productId, organizationId },
      select: { id: true, name: true, sku: true, reorderLevel: true, unit: { select: { code: true } } },
    });
    if (!product) throw notFound('PRODUCT_NOT_FOUND', 'Product not found.');

    const [stock, batches, recentLedger] = await Promise.all([
      prisma.inventoryStock.findMany({
        where: { organizationId, productId: product.id },
        include: { warehouse: { select: { id: true, name: true, type: true } } },
      }),
      prisma.inventoryBatch.findMany({
        where: { organizationId, productId: product.id, quantity: { gt: 0 } },
        orderBy: { expiryDate: 'asc' },
        include: { warehouse: { select: { id: true, name: true } } },
      }),
      prisma.inventoryLedger.findMany({
        where: { organizationId, productId: product.id },
        orderBy: { createdAt: 'desc' },
        take: 25,
        include: { warehouse: { select: { id: true, name: true } } },
      }),
    ]);

    return ok(res, {
      product,
      stock: stock.map((s) => ({
        ...s,
        availableQuantity: D(s.quantity).minus(D(s.reservedQuantity)).toFixed(4),
        stockStatus: stockStatus(s.quantity, product.reorderLevel),
      })),
      batches,
      recentLedger,
    });
  }),
);

async function notifyAffectedStock(
  organizationId: string,
  warehouseId: string,
  productIds: string[],
): Promise<void> {
  const rows = await prisma.inventoryStock.findMany({
    where: { organizationId, warehouseId, productId: { in: productIds } },
    select: { id: true },
  });
  await Promise.all(rows.map((row) => checkStockThresholds(row.id)));
}

export { notifyAffectedStock };
export default router;
