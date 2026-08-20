import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, transaction } from '../../lib/prisma';
import { created, ok, pageMeta } from '../../lib/http';
import { notFound } from '../../lib/errors';
import { ZERO } from '../../lib/decimal';
import { paginationSchema, positiveDecimal, skipTake, uuidParam } from '../../lib/query';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../middleware/asyncHandler';
import { idempotency } from '../../middleware/idempotency';
import { orgId, requirePermission, userId } from '../../middleware/auth';
import { auditFromRequest } from '../../services/audit.service';
import { consumeStock } from '../../services/inventory.service';
import { nextDocumentNumber } from '../../services/numbering.service';

const router = Router();

const createSchema = z.object({
  supplierId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  purchaseOrderId: z.string().uuid().nullable().optional(),
  reason: z.string().trim().max(500).optional(),
  items: z
    .array(z.object({ productId: z.string().uuid(), quantity: positiveDecimal }))
    .min(1, 'At least one item is required'),
});

router.get(
  '/',
  requirePermission('purchase.view'),
  validate({ query: paginationSchema.extend({ supplierId: z.string().uuid().optional() }) }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof paginationSchema> & { supplierId?: string };
    const where: Prisma.PurchaseReturnWhereInput = {
      organizationId: orgId(req),
      ...(q.supplierId ? { supplierId: q.supplierId } : {}),
      ...(q.from || q.to ? { createdAt: { gte: q.from, lte: q.to } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.purchaseReturn.findMany({
        where,
        ...skipTake(q),
        orderBy: { createdAt: q.sortDir },
        include: {
          supplier: { select: { id: true, name: true } },
          warehouse: { select: { id: true, name: true } },
          items: { include: { product: { select: { id: true, name: true, sku: true } } } },
        },
      }),
      prisma.purchaseReturn.count({ where }),
    ]);
    return ok(res, rows, pageMeta(q.page, q.perPage, total));
  }),
);

router.get(
  '/:id',
  requirePermission('purchase.view'),
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => {
    const row = await prisma.purchaseReturn.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
      include: { supplier: true, warehouse: true, items: { include: { product: true } } },
    });
    if (!row) throw notFound('NOT_FOUND', 'Purchase return not found.');
    return ok(res, row);
  }),
);

router.post(
  '/',
  requirePermission('purchase.return'),
  validate({ body: createSchema }),
  idempotency,
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const performedBy = userId(req);
    const body = req.body as z.infer<typeof createSchema>;

    const result = await transaction(async (tx) => {
      const supplier = await tx.supplier.findFirst({
        where: { id: body.supplierId, organizationId },
        select: { id: true },
      });
      if (!supplier) throw notFound('SUPPLIER_NOT_FOUND', 'Supplier not found.');

      const purchaseReturn = await tx.purchaseReturn.create({
        data: {
          organizationId,
          returnNumber: await nextDocumentNumber(organizationId, 'PRT', tx),
          supplierId: body.supplierId,
          warehouseId: body.warehouseId,
          purchaseOrderId: body.purchaseOrderId ?? null,
          reason: body.reason,
          createdBy: performedBy,
        },
      });

      let totalValue = ZERO;
      for (const item of body.items) {
        const { totalCost } = await consumeStock(tx, {
          organizationId,
          productId: item.productId,
          warehouseId: body.warehouseId,
          transactionType: 'PURCHASE_RETURN',
          quantity: item.quantity,
          referenceType: 'PURCHASE_RETURN',
          referenceId: purchaseReturn.id,
          performedBy,
          notes: `Return ${purchaseReturn.returnNumber}`,
        });
        totalValue = totalValue.plus(totalCost);
        await tx.purchaseReturnItem.create({
          data: {
            purchaseReturnId: purchaseReturn.id,
            productId: item.productId,
            quantity: String(item.quantity),
            unitCost: totalCost.dividedBy(item.quantity).toDecimalPlaces(4),
          },
        });
      }

      return tx.purchaseReturn.update({
        where: { id: purchaseReturn.id },
        data: { totalValue },
        include: { items: true },
      });
    });

    await auditFromRequest(req, {
      action: 'PURCHASE_RETURN_CREATED',
      module: 'purchase',
      entityType: 'PurchaseReturn',
      entityId: result.id,
      newValue: result,
    });
    return created(res, result);
  }),
);

export default router;
