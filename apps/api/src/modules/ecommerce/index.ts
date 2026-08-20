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
import {
  consumeReservations,
  receiveStock,
  releaseReservations,
  reserveStock,
} from '../../services/inventory.service';
import { nextDocumentNumber } from '../../services/numbering.service';

export const ecommerceRouter = Router();

const itemSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable().optional(),
  quantity: positiveDecimal,
  unitPrice: nonNegativeDecimal.optional(),
});

const createSchema = z.object({
  warehouseId: z.string().uuid(),
  customerName: z.string().trim().max(160).optional(),
  customerEmail: z.string().email().optional(),
  customerPhone: z.string().trim().max(30).optional(),
  shippingAddress: z.string().trim().max(500).optional(),
  items: z.array(itemSchema).min(1, 'An order needs at least one item'),
});

/**
 * Expands bundle products into their component requirements so reservations
 * always happen against the components that actually hold stock.
 */
async function reservationLines(
  tx: Prisma.TransactionClient,
  organizationId: string,
  items: { productId: string; variantId?: string | null; quantity: Prisma.Decimal }[],
): Promise<{ productId: string; variantId: string | null; quantity: Prisma.Decimal }[]> {
  const lines: { productId: string; variantId: string | null; quantity: Prisma.Decimal }[] = [];
  for (const item of items) {
    const bundle = await tx.productBundle.findFirst({
      where: { organizationId, productId: item.productId, status: 'ACTIVE' },
      include: { items: true },
    });
    if (bundle && bundle.items.length > 0) {
      for (const component of bundle.items) {
        lines.push({
          productId: component.componentProductId,
          variantId: null,
          quantity: D(component.quantity).times(item.quantity).toDecimalPlaces(4),
        });
      }
    } else {
      lines.push({
        productId: item.productId,
        variantId: item.variantId ?? null,
        quantity: item.quantity,
      });
    }
  }
  return lines;
}

ecommerceRouter.get(
  '/orders',
  requirePermission('ecommerce.order.view'),
  validate({
    query: paginationSchema.extend({
      status: z.string().optional(),
      warehouseId: z.string().uuid().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof paginationSchema> & {
      status?: string;
      warehouseId?: string;
    };
    const where: Prisma.EcommerceOrderWhereInput = {
      organizationId: orgId(req),
      ...(q.status ? { status: q.status as Prisma.EnumEcommerceOrderStatusFilter['equals'] } : {}),
      ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
      ...(q.search
        ? {
            OR: [
              { orderNumber: { contains: q.search, mode: 'insensitive' } },
              { customerName: { contains: q.search, mode: 'insensitive' } },
              { customerEmail: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(q.from || q.to ? { createdAt: { gte: q.from, lte: q.to } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.ecommerceOrder.findMany({
        where,
        ...skipTake(q),
        orderBy: { createdAt: q.sortDir },
        include: {
          warehouse: { select: { id: true, name: true } },
          items: { include: { product: { select: { id: true, name: true, sku: true } } } },
        },
      }),
      prisma.ecommerceOrder.count({ where }),
    ]);
    return ok(res, rows, pageMeta(q.page, q.perPage, total));
  }),
);

ecommerceRouter.get(
  '/orders/:id',
  requirePermission('ecommerce.order.view'),
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => {
    const order = await prisma.ecommerceOrder.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
      include: {
        warehouse: true,
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
            variant: { select: { id: true, name: true, sku: true } },
          },
        },
        reservations: true,
      },
    });
    if (!order) throw notFound('NOT_FOUND', 'Order not found.');
    return ok(res, order);
  }),
);

ecommerceRouter.post(
  '/orders',
  requirePermission('ecommerce.order.manage'),
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const body = req.body as z.infer<typeof createSchema>;

    const products = await prisma.product.findMany({
      where: { organizationId, id: { in: body.items.map((i) => i.productId) } },
      select: { id: true, sellingPrice: true, taxRate: true },
    });
    if (products.length !== new Set(body.items.map((i) => i.productId)).size) {
      throw badRequest('PRODUCT_NOT_FOUND', 'One or more products do not exist.');
    }
    const productById = new Map(products.map((p) => [p.id, p]));

    let subtotal = ZERO;
    let taxTotal = ZERO;
    const items = body.items.map((item) => {
      const product = productById.get(item.productId)!;
      const unitPrice =
        item.unitPrice === undefined ? D(product.sellingPrice) : D(item.unitPrice);
      const net = unitPrice.times(D(item.quantity));
      const tax = net.times(D(product.taxRate)).dividedBy(100);
      subtotal = subtotal.plus(net);
      taxTotal = taxTotal.plus(tax);
      return {
        productId: item.productId,
        variantId: item.variantId ?? null,
        quantity: String(item.quantity),
        unitPrice,
        taxRate: product.taxRate,
        total: net.plus(tax).toDecimalPlaces(4),
      };
    });

    const order = await transaction(async (tx) =>
      tx.ecommerceOrder.create({
        data: {
          organizationId,
          orderNumber: await nextDocumentNumber(organizationId, 'EO', tx),
          warehouseId: body.warehouseId,
          customerName: body.customerName,
          customerEmail: body.customerEmail,
          customerPhone: body.customerPhone,
          shippingAddress: body.shippingAddress,
          subtotal: subtotal.toDecimalPlaces(4),
          taxTotal: taxTotal.toDecimalPlaces(4),
          grandTotal: subtotal.plus(taxTotal).toDecimalPlaces(4),
          createdBy: userId(req),
          items: { create: items },
        },
        include: { items: true },
      }),
    );

    await auditFromRequest(req, {
      action: 'ECOMMERCE_ORDER_CREATED',
      module: 'ecommerce',
      entityType: 'EcommerceOrder',
      entityId: order.id,
      newValue: order,
    });
    return created(res, order);
  }),
);

/** Payment confirmation reserves available stock (bundles expand to components). */
ecommerceRouter.post(
  '/orders/:id/confirm',
  requirePermission('ecommerce.order.manage'),
  validate({ params: uuidParam }),
  idempotency,
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const performedBy = userId(req);

    const order = await transaction(async (tx) => {
      const existing = await tx.ecommerceOrder.findFirst({
        where: { id: req.params.id, organizationId },
        include: { items: true },
      });
      if (!existing) throw notFound('NOT_FOUND', 'Order not found.');
      if (existing.status !== 'CREATED' && existing.status !== 'PAYMENT_CONFIRMED') {
        throw invalidState('Only new orders can be confirmed and reserved.');
      }

      const lines = await reservationLines(
        tx,
        organizationId,
        existing.items.map((i) => ({
          productId: i.productId,
          variantId: i.variantId,
          quantity: D(i.quantity),
        })),
      );

      for (const line of lines) {
        await reserveStock(tx, {
          organizationId,
          orderId: existing.id,
          productId: line.productId,
          variantId: line.variantId,
          warehouseId: existing.warehouseId,
          quantity: line.quantity,
          performedBy,
        });
      }

      return tx.ecommerceOrder.update({
        where: { id: existing.id },
        data: { status: 'RESERVED' },
        include: { items: true, reservations: true },
      });
    });

    await auditFromRequest(req, {
      action: 'ECOMMERCE_ORDER_RESERVED',
      module: 'ecommerce',
      entityType: 'EcommerceOrder',
      entityId: order.id,
      newValue: { status: order.status },
    });
    return ok(res, order);
  }),
);

ecommerceRouter.post(
  '/orders/:id/pack',
  requirePermission('ecommerce.order.manage'),
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => {
    const order = await prisma.ecommerceOrder.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
    });
    if (!order) throw notFound('NOT_FOUND', 'Order not found.');
    if (order.status !== 'RESERVED') {
      throw invalidState('Only reserved orders can be packed.');
    }
    const updated = await prisma.ecommerceOrder.update({
      where: { id: order.id },
      data: { status: 'PACKED' },
    });
    return ok(res, updated);
  }),
);

/** Shipment turns reservations into physical stock deductions (SALE ledger). */
ecommerceRouter.post(
  '/orders/:id/ship',
  requirePermission('ecommerce.order.manage'),
  validate({ params: uuidParam }),
  idempotency,
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const performedBy = userId(req);

    const order = await transaction(async (tx) => {
      const existing = await tx.ecommerceOrder.findFirst({
        where: { id: req.params.id, organizationId },
      });
      if (!existing) throw notFound('NOT_FOUND', 'Order not found.');
      if (!['RESERVED', 'PACKED'].includes(existing.status)) {
        throw invalidState('Only reserved or packed orders can be shipped.');
      }
      await consumeReservations(tx, organizationId, existing.id, performedBy);
      return tx.ecommerceOrder.update({
        where: { id: existing.id },
        data: { status: 'SHIPPED', shippedAt: new Date() },
        include: { items: true },
      });
    });

    await auditFromRequest(req, {
      action: 'ECOMMERCE_ORDER_SHIPPED',
      module: 'ecommerce',
      entityType: 'EcommerceOrder',
      entityId: order.id,
      newValue: { status: order.status },
    });
    return ok(res, order);
  }),
);

ecommerceRouter.post(
  '/orders/:id/complete',
  requirePermission('ecommerce.order.manage'),
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => {
    const order = await prisma.ecommerceOrder.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
    });
    if (!order) throw notFound('NOT_FOUND', 'Order not found.');
    if (order.status !== 'SHIPPED') {
      throw invalidState('Only shipped orders can be completed.');
    }
    const updated = await prisma.ecommerceOrder.update({
      where: { id: order.id },
      data: { status: 'COMPLETED' },
    });
    return ok(res, updated);
  }),
);

/** Cancellation releases active reservations; shipped orders must be returned. */
ecommerceRouter.post(
  '/orders/:id/cancel',
  requirePermission('ecommerce.order.manage'),
  validate({ params: uuidParam }),
  idempotency,
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const performedBy = userId(req);

    const order = await transaction(async (tx) => {
      const existing = await tx.ecommerceOrder.findFirst({
        where: { id: req.params.id, organizationId },
      });
      if (!existing) throw notFound('NOT_FOUND', 'Order not found.');
      if (['SHIPPED', 'COMPLETED', 'RETURNED'].includes(existing.status)) {
        throw invalidState('Shipped orders cannot be cancelled — record a return instead.');
      }
      await releaseReservations(tx, organizationId, existing.id, 'RELEASED', performedBy);
      return tx.ecommerceOrder.update({
        where: { id: existing.id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
    });

    await auditFromRequest(req, {
      action: 'ECOMMERCE_ORDER_CANCELLED',
      module: 'ecommerce',
      entityType: 'EcommerceOrder',
      entityId: order.id,
      newValue: { status: order.status },
    });
    return ok(res, order);
  }),
);

/** Validated returns put stock back with a SALE_RETURN ledger entry. */
ecommerceRouter.post(
  '/orders/:id/return',
  requirePermission('ecommerce.order.manage'),
  validate({
    params: uuidParam,
    body: z.object({
      restock: z.boolean().default(true),
      notes: z.string().trim().max(500).optional(),
      items: z
        .array(z.object({ orderItemId: z.string().uuid(), quantity: positiveDecimal }))
        .min(1),
    }),
  }),
  idempotency,
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const performedBy = userId(req);
    const body = req.body as {
      restock: boolean;
      notes?: string;
      items: { orderItemId: string; quantity: string | number }[];
    };

    const order = await transaction(async (tx) => {
      const existing = await tx.ecommerceOrder.findFirst({
        where: { id: req.params.id, organizationId },
        include: { items: true },
      });
      if (!existing) throw notFound('NOT_FOUND', 'Order not found.');
      if (!['SHIPPED', 'COMPLETED', 'RETURNED'].includes(existing.status)) {
        throw invalidState('Only shipped orders can be returned.');
      }

      for (const line of body.items) {
        const item = existing.items.find((i) => i.id === line.orderItemId);
        if (!item) throw badRequest('VALIDATION_ERROR', 'Unknown order item.');
        const quantity = D(line.quantity);
        const outstanding = D(item.quantity).minus(D(item.returnedQuantity));
        if (quantity.greaterThan(outstanding)) {
          throw badRequest('INVALID_QUANTITY', 'Return quantity exceeds the shipped quantity.');
        }

        if (body.restock) {
          const stock = await tx.inventoryStock.findFirst({
            where: {
              organizationId,
              productId: item.productId,
              warehouseId: existing.warehouseId,
              variantId: item.variantId,
            },
            select: { averageCost: true },
          });
          await receiveStock(tx, {
            organizationId,
            productId: item.productId,
            variantId: item.variantId,
            warehouseId: existing.warehouseId,
            transactionType: 'SALE_RETURN',
            quantityChange: quantity,
            unitCost: stock?.averageCost ?? ZERO,
            referenceType: 'ECOMMERCE_RETURN',
            referenceId: existing.id,
            performedBy,
            notes: body.notes ?? `Return for order ${existing.orderNumber}`,
          });
        }

        await tx.ecommerceOrderItem.update({
          where: { id: item.id },
          data: { returnedQuantity: D(item.returnedQuantity).plus(quantity) },
        });
      }

      const refreshed = await tx.ecommerceOrder.findUniqueOrThrow({
        where: { id: existing.id },
        include: { items: true },
      });
      const fullyReturned = refreshed.items.every((i) =>
        D(i.returnedQuantity).greaterThanOrEqualTo(D(i.quantity)),
      );
      return tx.ecommerceOrder.update({
        where: { id: refreshed.id },
        data: fullyReturned ? { status: 'RETURNED' } : {},
        include: { items: true },
      });
    });

    await auditFromRequest(req, {
      action: 'ECOMMERCE_ORDER_RETURNED',
      module: 'ecommerce',
      entityType: 'EcommerceOrder',
      entityId: order.id,
      newValue: { status: order.status },
    });
    return ok(res, order);
  }),
);

ecommerceRouter.get(
  '/reservations',
  requirePermission('ecommerce.order.view'),
  validate({
    query: paginationSchema.extend({
      status: z.enum(['ACTIVE', 'RELEASED', 'CONSUMED', 'EXPIRED']).optional(),
      warehouseId: z.string().uuid().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof paginationSchema> & {
      status?: 'ACTIVE' | 'RELEASED' | 'CONSUMED' | 'EXPIRED';
      warehouseId?: string;
    };
    const where: Prisma.InventoryReservationWhereInput = {
      organizationId: orgId(req),
      ...(q.status ? { status: q.status } : {}),
      ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.inventoryReservation.findMany({
        where,
        ...skipTake(q),
        orderBy: { createdAt: q.sortDir },
        include: {
          product: { select: { id: true, name: true, sku: true } },
          warehouse: { select: { id: true, name: true } },
          order: { select: { id: true, orderNumber: true, status: true } },
        },
      }),
      prisma.inventoryReservation.count({ where }),
    ]);
    return ok(res, rows, pageMeta(q.page, q.perPage, total));
  }),
);

export default ecommerceRouter;
