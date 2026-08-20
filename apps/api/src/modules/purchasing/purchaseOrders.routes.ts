import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, transaction } from '../../lib/prisma';
import { created, ok, pageMeta } from '../../lib/http';
import { badRequest, invalidState, notFound } from '../../lib/errors';
import { D, ZERO } from '../../lib/decimal';
import {
  nonNegativeDecimal,
  paginationSchema,
  positiveDecimal,
  skipTake,
  uuidParam,
} from '../../lib/query';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../middleware/asyncHandler';
import { idempotency } from '../../middleware/idempotency';
import { orgId, requirePermission, userId } from '../../middleware/auth';
import { auditFromRequest } from '../../services/audit.service';
import { receiveStock } from '../../services/inventory.service';
import { nextDocumentNumber } from '../../services/numbering.service';
import { convertToProductUnit } from '../../services/unit.service';

const router = Router();

const itemSchema = z.object({
  productId: z.string().uuid(),
  unitId: z.string().uuid().nullable().optional(),
  quantity: positiveDecimal,
  unitCost: nonNegativeDecimal,
  taxRate: nonNegativeDecimal.default(0),
  discount: nonNegativeDecimal.default(0),
});

const createSchema = z.object({
  supplierId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  orderDate: z.coerce.date().optional(),
  expectedDeliveryDate: z.coerce.date().nullable().optional(),
  shippingTotal: nonNegativeDecimal.default(0),
  notes: z.string().trim().max(1000).optional(),
  submit: z.boolean().default(false),
  items: z.array(itemSchema).min(1, 'A purchase order needs at least one item'),
});

interface Totals {
  subtotal: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  grandTotal: Prisma.Decimal;
  lines: { lineTotal: Prisma.Decimal }[];
}

function computeTotals(
  items: z.infer<typeof itemSchema>[],
  shippingTotal: Prisma.Decimal | number | string,
): Totals {
  let subtotal = ZERO;
  let taxTotal = ZERO;
  let discountTotal = ZERO;
  const lines: { lineTotal: Prisma.Decimal }[] = [];

  for (const item of items) {
    const gross = D(item.quantity).times(D(item.unitCost));
    const discount = D(item.discount);
    const net = gross.minus(discount);
    const tax = net.times(D(item.taxRate)).dividedBy(100);
    subtotal = subtotal.plus(gross);
    discountTotal = discountTotal.plus(discount);
    taxTotal = taxTotal.plus(tax);
    lines.push({ lineTotal: net.plus(tax).toDecimalPlaces(4) });
  }

  return {
    subtotal: subtotal.toDecimalPlaces(4),
    taxTotal: taxTotal.toDecimalPlaces(4),
    discountTotal: discountTotal.toDecimalPlaces(4),
    grandTotal: subtotal
      .minus(discountTotal)
      .plus(taxTotal)
      .plus(D(shippingTotal))
      .toDecimalPlaces(4),
    lines,
  };
}

router.get(
  '/',
  requirePermission('purchase.view'),
  validate({
    query: paginationSchema.extend({
      status: z.string().optional(),
      supplierId: z.string().uuid().optional(),
      warehouseId: z.string().uuid().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof paginationSchema> & {
      status?: string;
      supplierId?: string;
      warehouseId?: string;
    };
    const where: Prisma.PurchaseOrderWhereInput = {
      organizationId: orgId(req),
      ...(q.status ? { status: q.status as Prisma.EnumPurchaseOrderStatusFilter['equals'] } : {}),
      ...(q.supplierId ? { supplierId: q.supplierId } : {}),
      ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
      ...(q.search ? { poNumber: { contains: q.search, mode: 'insensitive' } } : {}),
      ...(q.from || q.to ? { orderDate: { gte: q.from, lte: q.to } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        ...skipTake(q),
        orderBy: { createdAt: q.sortDir },
        include: {
          supplier: { select: { id: true, name: true } },
          warehouse: { select: { id: true, name: true } },
          items: { select: { id: true, productId: true, quantity: true, receivedQuantity: true } },
        },
      }),
      prisma.purchaseOrder.count({ where }),
    ]);
    return ok(res, rows, pageMeta(q.page, q.perPage, total));
  }),
);

router.get(
  '/:id',
  requirePermission('purchase.view'),
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => {
    const po = await prisma.purchaseOrder.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
      include: {
        supplier: true,
        warehouse: { select: { id: true, name: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
            unit: { select: { id: true, code: true } },
          },
        },
        receipts: { include: { items: true }, orderBy: { receivedDate: 'desc' } },
        returns: { include: { items: true } },
      },
    });
    if (!po) throw notFound('PURCHASE_NOT_FOUND', 'Purchase order not found.');
    return ok(res, po);
  }),
);

router.post(
  '/',
  requirePermission('purchase.create'),
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const body = req.body as z.infer<typeof createSchema>;

    const [supplier, warehouse, products] = await Promise.all([
      prisma.supplier.findFirst({ where: { id: body.supplierId, organizationId } }),
      prisma.warehouse.findFirst({ where: { id: body.warehouseId, organizationId } }),
      prisma.product.findMany({
        where: { organizationId, id: { in: body.items.map((i) => i.productId) } },
        select: { id: true },
      }),
    ]);
    if (!supplier) throw notFound('SUPPLIER_NOT_FOUND', 'Supplier not found.');
    if (!warehouse) throw notFound('WAREHOUSE_NOT_FOUND', 'Warehouse not found.');
    if (products.length !== new Set(body.items.map((i) => i.productId)).size) {
      throw badRequest('PRODUCT_NOT_FOUND', 'One or more products do not exist.');
    }

    const totals = computeTotals(body.items, body.shippingTotal);

    const po = await transaction(async (tx) =>
      tx.purchaseOrder.create({
        data: {
          organizationId,
          poNumber: await nextDocumentNumber(organizationId, 'PO', tx),
          supplierId: body.supplierId,
          warehouseId: body.warehouseId,
          orderDate: body.orderDate ?? new Date(),
          expectedDeliveryDate: body.expectedDeliveryDate ?? null,
          status: body.submit ? 'SUBMITTED' : 'DRAFT',
          subtotal: totals.subtotal,
          taxTotal: totals.taxTotal,
          discountTotal: totals.discountTotal,
          shippingTotal: D(body.shippingTotal),
          grandTotal: totals.grandTotal,
          notes: body.notes,
          createdBy: userId(req),
          items: {
            create: body.items.map((item, index) => ({
              productId: item.productId,
              unitId: item.unitId ?? null,
              quantity: String(item.quantity),
              unitCost: String(item.unitCost),
              taxRate: String(item.taxRate),
              discount: String(item.discount),
              total: totals.lines[index].lineTotal,
            })),
          },
        },
        include: { items: true },
      }),
    );

    await auditFromRequest(req, {
      action: 'PURCHASE_ORDER_CREATED',
      module: 'purchase',
      entityType: 'PurchaseOrder',
      entityId: po.id,
      newValue: po,
    });
    return created(res, po);
  }),
);

router.put(
  '/:id',
  requirePermission('purchase.update'),
  validate({ params: uuidParam, body: createSchema.partial({ supplierId: true, warehouseId: true }) }),
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const existing = await prisma.purchaseOrder.findFirst({
      where: { id: req.params.id, organizationId },
      include: { items: true },
    });
    if (!existing) throw notFound('PURCHASE_NOT_FOUND', 'Purchase order not found.');
    if (existing.status !== 'DRAFT' && existing.status !== 'SUBMITTED') {
      throw invalidState('Only draft or submitted purchase orders can be edited.');
    }
    const body = req.body as Partial<z.infer<typeof createSchema>>;
    const items = body.items ?? [];
    const shipping = body.shippingTotal ?? existing.shippingTotal;
    const totals = items.length > 0 ? computeTotals(items, shipping) : null;

    const po = await transaction(async (tx) => {
      if (totals) {
        await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: existing.id } });
        await tx.purchaseOrderItem.createMany({
          data: items.map((item, index) => ({
            purchaseOrderId: existing.id,
            productId: item.productId,
            unitId: item.unitId ?? null,
            quantity: String(item.quantity),
            unitCost: String(item.unitCost),
            taxRate: String(item.taxRate),
            discount: String(item.discount),
            total: totals.lines[index].lineTotal.toFixed(4),
          })),
        });
      }
      return tx.purchaseOrder.update({
        where: { id: existing.id },
        data: {
          supplierId: body.supplierId ?? existing.supplierId,
          warehouseId: body.warehouseId ?? existing.warehouseId,
          expectedDeliveryDate:
            body.expectedDeliveryDate === undefined
              ? existing.expectedDeliveryDate
              : body.expectedDeliveryDate,
          notes: body.notes ?? existing.notes,
          shippingTotal: D(shipping),
          status: body.submit ? 'SUBMITTED' : existing.status,
          ...(totals
            ? {
                subtotal: totals.subtotal,
                taxTotal: totals.taxTotal,
                discountTotal: totals.discountTotal,
                grandTotal: totals.grandTotal,
              }
            : {}),
        },
        include: { items: true },
      });
    });

    await auditFromRequest(req, {
      action: 'PURCHASE_ORDER_UPDATED',
      module: 'purchase',
      entityType: 'PurchaseOrder',
      entityId: po.id,
      oldValue: existing,
      newValue: po,
    });
    return ok(res, po);
  }),
);

router.post(
  '/:id/approve',
  requirePermission('purchase.approve'),
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => {
    const existing = await prisma.purchaseOrder.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
    });
    if (!existing) throw notFound('PURCHASE_NOT_FOUND', 'Purchase order not found.');
    if (existing.status !== 'SUBMITTED' && existing.status !== 'DRAFT') {
      throw invalidState('Only submitted purchase orders can be approved.');
    }
    const po = await prisma.purchaseOrder.update({
      where: { id: existing.id },
      data: { status: 'APPROVED', approvedBy: userId(req), approvedAt: new Date() },
    });
    await auditFromRequest(req, {
      action: 'PURCHASE_ORDER_APPROVED',
      module: 'purchase',
      entityType: 'PurchaseOrder',
      entityId: po.id,
      oldValue: existing,
      newValue: po,
    });
    return ok(res, po);
  }),
);

router.post(
  '/:id/cancel',
  requirePermission('purchase.update'),
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => {
    const existing = await prisma.purchaseOrder.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
      include: { items: true },
    });
    if (!existing) throw notFound('PURCHASE_NOT_FOUND', 'Purchase order not found.');
    if (existing.items.some((i) => D(i.receivedQuantity).greaterThan(0))) {
      throw invalidState('Partially received purchase orders cannot be cancelled.');
    }
    const po = await prisma.purchaseOrder.update({
      where: { id: existing.id },
      data: { status: 'CANCELLED' },
    });
    await auditFromRequest(req, {
      action: 'PURCHASE_ORDER_CANCELLED',
      module: 'purchase',
      entityType: 'PurchaseOrder',
      entityId: po.id,
      newValue: po,
    });
    return ok(res, po);
  }),
);

// --------------------------------------------------------- goods receiving ---

const receiveSchema = z.object({
  invoiceNumber: z.string().trim().max(60).optional(),
  invoiceDate: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(1000).optional(),
  items: z
    .array(
      z.object({
        purchaseOrderItemId: z.string().uuid(),
        quantity: positiveDecimal,
        unitCost: nonNegativeDecimal.optional(),
        batchNumber: z.string().trim().max(60).optional(),
        manufacturingDate: z.coerce.date().nullable().optional(),
        expiryDate: z.coerce.date().nullable().optional(),
      }),
    )
    .min(1, 'At least one received line is required'),
});

router.post(
  '/:id/receive',
  requirePermission('purchase.receive'),
  validate({ params: uuidParam, body: receiveSchema }),
  idempotency,
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const receivedBy = userId(req);
    const body = req.body as z.infer<typeof receiveSchema>;

    const receipt = await transaction(async (tx) => {
      const po = await tx.purchaseOrder.findFirst({
        where: { id: req.params.id, organizationId },
        include: { items: { include: { product: { select: { id: true, unitId: true, trackBatches: true } } } } },
      });
      if (!po) throw notFound('PURCHASE_NOT_FOUND', 'Purchase order not found.');
      if (!['APPROVED', 'PARTIALLY_RECEIVED'].includes(po.status)) {
        throw invalidState('Only approved purchase orders can be received.');
      }

      const grn = await tx.goodsReceipt.create({
        data: {
          organizationId,
          grnNumber: await nextDocumentNumber(organizationId, 'GRN', tx),
          purchaseOrderId: po.id,
          supplierId: po.supplierId,
          warehouseId: po.warehouseId,
          receivedBy,
          invoiceNumber: body.invoiceNumber,
          invoiceDate: body.invoiceDate ?? null,
          notes: body.notes,
        },
      });

      for (const line of body.items) {
        const item = po.items.find((i) => i.id === line.purchaseOrderItemId);
        if (!item) throw badRequest('VALIDATION_ERROR', 'Unknown purchase order item.');

        const outstanding = D(item.quantity).minus(D(item.receivedQuantity));
        const quantity = D(line.quantity);
        if (quantity.greaterThan(outstanding)) {
          throw badRequest(
            'INVALID_QUANTITY',
            'Received quantity exceeds the outstanding ordered quantity.',
          );
        }

        const unitCost = line.unitCost === undefined ? D(item.unitCost) : D(line.unitCost);
        // Purchase lines may be ordered in a different unit than the stocking unit.
        const stockQuantity = await convertToProductUnit(
          organizationId,
          item.product.unitId,
          quantity,
          item.unitId,
          tx,
        );
        const stockUnitCost = unitCost
          .times(quantity)
          .dividedBy(stockQuantity.equals(0) ? D(1) : stockQuantity)
          .toDecimalPlaces(4);

        const batchNumber =
          line.batchNumber ?? (item.product.trackBatches ? `${grn.grnNumber}-${item.id.slice(0, 8)}` : undefined);

        await receiveStock(tx, {
          organizationId,
          productId: item.productId,
          warehouseId: po.warehouseId,
          transactionType: 'PURCHASE',
          quantityChange: stockQuantity,
          unitCost: stockUnitCost,
          referenceType: 'GOODS_RECEIPT',
          referenceId: grn.id,
          performedBy: receivedBy,
          notes: `GRN ${grn.grnNumber}`,
          batch: batchNumber
            ? {
                batchNumber,
                manufacturingDate: line.manufacturingDate ?? null,
                expiryDate: line.expiryDate ?? null,
                supplierId: po.supplierId,
                purchaseOrderId: po.id,
              }
            : null,
        });

        await tx.goodsReceiptItem.create({
          data: {
            goodsReceiptId: grn.id,
            purchaseOrderItemId: item.id,
            productId: item.productId,
            quantity,
            unitCost,
            batchNumber,
            manufacturingDate: line.manufacturingDate ?? null,
            expiryDate: line.expiryDate ?? null,
          },
        });

        await tx.purchaseOrderItem.update({
          where: { id: item.id },
          data: { receivedQuantity: D(item.receivedQuantity).plus(quantity) },
        });

        await tx.supplierProduct.upsert({
          where: {
            supplierId_productId: { supplierId: po.supplierId, productId: item.productId },
          },
          create: {
            supplierId: po.supplierId,
            productId: item.productId,
            lastPrice: unitCost,
          },
          update: { lastPrice: unitCost },
        });
      }

      const refreshed = await tx.purchaseOrder.findUniqueOrThrow({
        where: { id: po.id },
        include: { items: true },
      });
      const fully = refreshed.items.every((i) =>
        D(i.receivedQuantity).greaterThanOrEqualTo(D(i.quantity)),
      );
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: fully ? 'FULLY_RECEIVED' : 'PARTIALLY_RECEIVED' },
      });

      return tx.goodsReceipt.findUniqueOrThrow({
        where: { id: grn.id },
        include: { items: true, purchaseOrder: { select: { id: true, poNumber: true, status: true } } },
      });
    });

    await auditFromRequest(req, {
      action: 'GOODS_RECEIVED',
      module: 'purchase',
      entityType: 'GoodsReceipt',
      entityId: receipt.id,
      newValue: receipt,
    });
    return created(res, receipt);
  }),
);

router.get(
  '/receipts/list',
  requirePermission('purchase.view'),
  validate({
    query: paginationSchema.extend({
      supplierId: z.string().uuid().optional(),
      warehouseId: z.string().uuid().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof paginationSchema> & {
      supplierId?: string;
      warehouseId?: string;
    };
    const where: Prisma.GoodsReceiptWhereInput = {
      organizationId: orgId(req),
      ...(q.supplierId ? { supplierId: q.supplierId } : {}),
      ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
      ...(q.from || q.to ? { receivedDate: { gte: q.from, lte: q.to } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.goodsReceipt.findMany({
        where,
        ...skipTake(q),
        orderBy: { receivedDate: q.sortDir },
        include: {
          supplier: { select: { id: true, name: true } },
          warehouse: { select: { id: true, name: true } },
          purchaseOrder: { select: { id: true, poNumber: true } },
          items: true,
        },
      }),
      prisma.goodsReceipt.count({ where }),
    ]);
    return ok(res, rows, pageMeta(q.page, q.perPage, total));
  }),
);

export default router;
