import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, transaction } from '../../lib/prisma';
import { created, ok, pageMeta } from '../../lib/http';
import { badRequest, invalidState, notFound } from '../../lib/errors';
import { D, ZERO } from '../../lib/decimal';
import { nonNegativeDecimal, paginationSchema, positiveDecimal, skipTake, uuidParam } from '../../lib/query';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../middleware/asyncHandler';
import { idempotency } from '../../middleware/idempotency';
import { orgId, requirePermission, userId } from '../../middleware/auth';
import { auditFromRequest } from '../../services/audit.service';
import { consumeStock } from '../../services/inventory.service';
import { consumeRecipeIngredients, expandRecipe } from '../../services/recipe.service';
import { nextDocumentNumber } from '../../services/numbering.service';
import recipesRouter from './recipes.routes';

export const restaurantRouter = Router();

restaurantRouter.use('/recipes', recipesRouter);

const orderItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: positiveDecimal,
  unitPrice: nonNegativeDecimal.optional(),
});

const createOrderSchema = z.object({
  warehouseId: z.string().uuid(),
  tableNumber: z.string().trim().max(20).optional(),
  customerName: z.string().trim().max(160).optional(),
  items: z.array(orderItemSchema).min(1, 'An order needs at least one item'),
});

restaurantRouter.get(
  '/orders',
  requirePermission('restaurant.order.view'),
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
    const where: Prisma.RestaurantOrderWhereInput = {
      organizationId: orgId(req),
      ...(q.status ? { status: q.status as Prisma.EnumRestaurantOrderStatusFilter['equals'] } : {}),
      ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
      ...(q.search ? { orderNumber: { contains: q.search, mode: 'insensitive' } } : {}),
      ...(q.from || q.to ? { createdAt: { gte: q.from, lte: q.to } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.restaurantOrder.findMany({
        where,
        ...skipTake(q),
        orderBy: { createdAt: q.sortDir },
        include: {
          warehouse: { select: { id: true, name: true } },
          items: { include: { product: { select: { id: true, name: true, sku: true } } } },
        },
      }),
      prisma.restaurantOrder.count({ where }),
    ]);
    return ok(res, rows, pageMeta(q.page, q.perPage, total));
  }),
);

restaurantRouter.get(
  '/orders/:id',
  requirePermission('restaurant.order.view'),
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => {
    const order = await prisma.restaurantOrder.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
      include: {
        warehouse: true,
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
      },
    });
    if (!order) throw notFound('NOT_FOUND', 'Restaurant order not found.');
    return ok(res, order);
  }),
);

restaurantRouter.post(
  '/orders',
  requirePermission('restaurant.order.manage'),
  validate({ body: createOrderSchema }),
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const body = req.body as z.infer<typeof createOrderSchema>;

    const products = await prisma.product.findMany({
      where: { organizationId, id: { in: body.items.map((i) => i.productId) } },
      select: { id: true, sellingPrice: true, taxRate: true },
    });
    if (products.length !== new Set(body.items.map((i) => i.productId)).size) {
      throw badRequest('PRODUCT_NOT_FOUND', 'One or more products do not exist.');
    }
    const priceOf = new Map(products.map((p) => [p.id, p.sellingPrice]));

    let totalAmount = ZERO;
    const items = body.items.map((item) => {
      const unitPrice = item.unitPrice === undefined ? D(priceOf.get(item.productId) ?? 0) : D(item.unitPrice);
      const total = unitPrice.times(D(item.quantity)).toDecimalPlaces(4);
      totalAmount = totalAmount.plus(total);
      return {
        productId: item.productId,
        quantity: String(item.quantity),
        unitPrice,
        total,
      };
    });

    const order = await transaction(async (tx) =>
      tx.restaurantOrder.create({
        data: {
          organizationId,
          orderNumber: await nextDocumentNumber(organizationId, 'RO', tx),
          warehouseId: body.warehouseId,
          tableNumber: body.tableNumber,
          customerName: body.customerName,
          totalAmount,
          createdBy: userId(req),
          items: { create: items },
        },
        include: { items: true },
      }),
    );

    await auditFromRequest(req, {
      action: 'RESTAURANT_ORDER_CREATED',
      module: 'restaurant',
      entityType: 'RestaurantOrder',
      entityId: order.id,
      newValue: order,
    });
    return created(res, order);
  }),
);

restaurantRouter.post(
  '/orders/:id/status',
  requirePermission('restaurant.order.manage'),
  validate({
    params: uuidParam,
    body: z.object({ status: z.enum(['IN_KITCHEN', 'PREPARED', 'CANCELLED']) }),
  }),
  asyncHandler(async (req, res) => {
    const order = await prisma.restaurantOrder.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
    });
    if (!order) throw notFound('NOT_FOUND', 'Restaurant order not found.');
    if (order.status === 'COMPLETED') {
      throw invalidState('Completed orders cannot change status.');
    }
    const updated = await prisma.restaurantOrder.update({
      where: { id: order.id },
      data: { status: req.body.status },
    });
    return ok(res, updated);
  }),
);

/**
 * Completing an order consumes every recipe ingredient from the kitchen
 * warehouse through the inventory ledger, exactly once (idempotent).
 */
restaurantRouter.post(
  '/orders/:id/complete',
  requirePermission('restaurant.consumption.record'),
  validate({ params: uuidParam }),
  idempotency,
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const performedBy = userId(req);

    const result = await transaction(async (tx) => {
      const order = await tx.restaurantOrder.findFirst({
        where: { id: req.params.id, organizationId },
        include: { items: true },
      });
      if (!order) throw notFound('NOT_FOUND', 'Restaurant order not found.');
      if (order.status === 'COMPLETED') {
        throw invalidState('Order has already been completed and consumed.');
      }
      if (order.status === 'CANCELLED') {
        throw invalidState('Cancelled orders cannot be completed.');
      }

      let ingredientCost = ZERO;
      const consumption: { productId: string; productName: string; quantity: string; cost: string }[] = [];

      for (const item of order.items) {
        const { lines, totalCost } = await consumeRecipeIngredients(tx, {
          organizationId,
          warehouseId: order.warehouseId,
          productId: item.productId,
          quantity: item.quantity,
          referenceType: 'RESTAURANT_ORDER',
          referenceId: order.id,
          performedBy,
        });
        ingredientCost = ingredientCost.plus(totalCost);
        consumption.push(
          ...lines.map((line) => ({
            productId: line.productId,
            productName: line.productName,
            quantity: line.quantity.toFixed(4),
            cost: line.cost.toFixed(4),
          })),
        );
      }

      const completed = await tx.restaurantOrder.update({
        where: { id: order.id },
        data: { status: 'COMPLETED', consumedAt: new Date() },
        include: { items: true },
      });

      const sales = D(completed.totalAmount);
      return {
        order: completed,
        consumption,
        ingredientCost: ingredientCost.toFixed(4),
        foodCostPercentage: sales.greaterThan(0)
          ? ingredientCost.dividedBy(sales).times(100).toDecimalPlaces(2).toFixed(2)
          : null,
      };
    });

    await auditFromRequest(req, {
      action: 'RESTAURANT_ORDER_COMPLETED',
      module: 'restaurant',
      entityType: 'RestaurantOrder',
      entityId: result.order.id,
      newValue: { status: 'COMPLETED', ingredientCost: result.ingredientCost },
    });
    return ok(res, result);
  }),
);

/** Ad-hoc consumption (kitchen prep without a customer order). */
restaurantRouter.post(
  '/consumption',
  requirePermission('restaurant.consumption.record'),
  validate({
    body: z.object({
      warehouseId: z.string().uuid(),
      notes: z.string().trim().max(500).optional(),
      items: z
        .array(
          z.object({
            productId: z.string().uuid(),
            quantity: positiveDecimal,
            /** When true the product is expanded through its recipe. */
            useRecipe: z.boolean().default(false),
          }),
        )
        .min(1),
    }),
  }),
  idempotency,
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const performedBy = userId(req);
    const body = req.body as {
      warehouseId: string;
      notes?: string;
      items: { productId: string; quantity: string | number; useRecipe: boolean }[];
    };

    const result = await transaction(async (tx) => {
      let totalCost = ZERO;
      const lines: { productId: string; quantity: string; cost: string }[] = [];

      for (const item of body.items) {
        if (item.useRecipe) {
          const { lines: recipeLines, totalCost: cost } = await consumeRecipeIngredients(tx, {
            organizationId,
            warehouseId: body.warehouseId,
            productId: item.productId,
            quantity: item.quantity,
            referenceType: 'MANUAL_CONSUMPTION',
            referenceId: item.productId,
            performedBy,
          });
          totalCost = totalCost.plus(cost);
          lines.push(
            ...recipeLines.map((l) => ({
              productId: l.productId,
              quantity: l.quantity.toFixed(4),
              cost: l.cost.toFixed(4),
            })),
          );
        } else {
          const { totalCost: cost } = await consumeStock(tx, {
            organizationId,
            productId: item.productId,
            warehouseId: body.warehouseId,
            transactionType: 'CONSUMPTION',
            quantity: item.quantity,
            referenceType: 'MANUAL_CONSUMPTION',
            performedBy,
            notes: body.notes,
          });
          totalCost = totalCost.plus(cost);
          lines.push({
            productId: item.productId,
            quantity: D(item.quantity).toFixed(4),
            cost: cost.toFixed(4),
          });
        }
      }

      return { lines, totalCost: totalCost.toFixed(4) };
    });

    await auditFromRequest(req, {
      action: 'CONSUMPTION_RECORDED',
      module: 'restaurant',
      entityType: 'InventoryLedger',
      newValue: result,
    });
    return created(res, result);
  }),
);

/** Preview the ingredient requirement for a product/quantity without consuming. */
restaurantRouter.get(
  '/recipes/:id/requirements',
  requirePermission('recipe.view'),
  validate({
    params: uuidParam,
    query: z.object({ quantity: positiveDecimal.default(1) }),
  }),
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const recipe = await prisma.recipe.findFirst({
      where: { id: req.params.id, organizationId },
      select: { productId: true },
    });
    if (!recipe) throw notFound('NOT_FOUND', 'Recipe not found.');
    const quantity = (req.query as unknown as { quantity: string }).quantity;
    const requirements = await transaction((tx) =>
      expandRecipe(tx, organizationId, recipe.productId, quantity),
    );
    return ok(
      res,
      requirements.map((r) => ({ ...r, quantity: r.quantity.toFixed(4) })),
    );
  }),
);

export default restaurantRouter;
