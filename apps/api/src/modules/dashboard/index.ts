import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { ok } from '../../lib/http';
import { D, ZERO } from '../../lib/decimal';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../middleware/asyncHandler';
import { orgId, requirePermission } from '../../middleware/auth';

export const dashboardRouter = Router();

const scope = z.object({ warehouseId: z.string().uuid().optional() });

const startOfToday = (): Date => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

const num = (value: Prisma.Decimal | number | string | null | undefined): string =>
  D(value ?? 0).toFixed(2);

/** Company-wide operational overview. */
dashboardRouter.get(
  '/admin',
  requirePermission('report.view'),
  validate({ query: scope }),
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const today = startOfToday();

    const [
      products,
      warehouses,
      stock,
      todaySales,
      todayPurchases,
      todayWastage,
      pendingPurchaseOrders,
      pendingTransfers,
      pendingAdjustments,
    ] = await Promise.all([
      prisma.product.count({ where: { organizationId, status: 'ACTIVE' } }),
      prisma.warehouse.count({ where: { organizationId, status: 'ACTIVE' } }),
      prisma.inventoryStock.findMany({
        where: { organizationId },
        select: {
          quantity: true,
          reservedQuantity: true,
          averageCost: true,
          product: { select: { reorderLevel: true } },
        },
      }),
      prisma.ecommerceOrder.aggregate({
        where: { organizationId, createdAt: { gte: today }, status: { not: 'CANCELLED' } },
        _sum: { grandTotal: true },
        _count: { _all: true },
      }),
      prisma.purchaseOrder.aggregate({
        where: { organizationId, orderDate: { gte: today }, status: { not: 'CANCELLED' } },
        _sum: { grandTotal: true },
        _count: { _all: true },
      }),
      prisma.wastage.aggregate({
        where: { organizationId, createdAt: { gte: today } },
        _sum: { estimatedCost: true },
        _count: { _all: true },
      }),
      prisma.purchaseOrder.count({
        where: { organizationId, status: { in: ['SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED'] } },
      }),
      prisma.stockTransfer.count({
        where: { organizationId, status: { in: ['REQUESTED', 'APPROVED', 'DISPATCHED'] } },
      }),
      prisma.stockAdjustment.count({ where: { organizationId, status: 'PENDING_APPROVAL' } }),
    ]);

    let inventoryValue = ZERO;
    let reserved = ZERO;
    let lowStock = 0;
    let outOfStock = 0;
    for (const row of stock) {
      inventoryValue = inventoryValue.plus(D(row.quantity).times(D(row.averageCost)));
      reserved = reserved.plus(D(row.reservedQuantity));
      if (D(row.quantity).lessThanOrEqualTo(0)) outOfStock += 1;
      else if (D(row.quantity).lessThanOrEqualTo(D(row.product.reorderLevel))) lowStock += 1;
    }

    return ok(res, {
      totalProducts: products,
      totalWarehouses: warehouses,
      totalInventoryValue: num(inventoryValue),
      reservedQuantity: num(reserved),
      lowStockCount: lowStock,
      outOfStockCount: outOfStock,
      todaySales: num(todaySales._sum.grandTotal),
      todaySalesOrders: todaySales._count._all,
      todayPurchases: num(todayPurchases._sum.grandTotal),
      todayPurchaseOrders: todayPurchases._count._all,
      todayWastageCost: num(todayWastage._sum.estimatedCost),
      todayWastageEntries: todayWastage._count._all,
      pendingPurchaseOrders,
      pendingTransfers,
      pendingAdjustments,
    });
  }),
);

/** Kitchen-focused dashboard. */
dashboardRouter.get(
  '/restaurant',
  requirePermission('report.view'),
  validate({ query: scope }),
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const today = startOfToday();
    const warehouseId = (req.query as z.infer<typeof scope>).warehouseId;
    const in7Days = new Date(Date.now() + 7 * 86_400_000);

    const [stock, consumption, wastage, expiring, topConsumed, sales] = await Promise.all([
      prisma.inventoryStock.findMany({
        where: { organizationId, ...(warehouseId ? { warehouseId } : {}) },
        select: {
          quantity: true,
          averageCost: true,
          product: { select: { name: true, reorderLevel: true, productType: true } },
        },
      }),
      prisma.inventoryLedger.aggregate({
        where: {
          organizationId,
          transactionType: 'CONSUMPTION',
          createdAt: { gte: today },
          ...(warehouseId ? { warehouseId } : {}),
        },
        _sum: { totalCost: true },
      }),
      prisma.wastage.aggregate({
        where: { organizationId, createdAt: { gte: today }, ...(warehouseId ? { warehouseId } : {}) },
        _sum: { estimatedCost: true },
      }),
      prisma.inventoryBatch.count({
        where: {
          organizationId,
          quantity: { gt: 0 },
          expiryDate: { not: null, lte: in7Days },
          ...(warehouseId ? { warehouseId } : {}),
        },
      }),
      prisma.inventoryLedger.groupBy({
        by: ['productId'],
        where: {
          organizationId,
          transactionType: 'CONSUMPTION',
          createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) },
          ...(warehouseId ? { warehouseId } : {}),
        },
        _sum: { quantityChange: true, totalCost: true },
        orderBy: { _sum: { totalCost: 'asc' } },
        take: 10,
      }),
      prisma.restaurantOrder.aggregate({
        where: { organizationId, status: 'COMPLETED', consumedAt: { gte: today }, ...(warehouseId ? { warehouseId } : {}) },
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
    ]);

    const products = await prisma.product.findMany({
      where: { id: { in: topConsumed.map((row) => row.productId) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(products.map((p) => [p.id, p.name]));

    const ingredientCost = D(consumption._sum.totalCost ?? 0).abs();
    const foodSales = D(sales._sum.totalAmount ?? 0);

    return ok(res, {
      kitchenStockLines: stock.length,
      kitchenStockValue: num(
        stock.reduce((sum, row) => sum.plus(D(row.quantity).times(D(row.averageCost))), ZERO),
      ),
      lowIngredients: stock.filter(
        (row) =>
          D(row.quantity).lessThanOrEqualTo(D(row.product.reorderLevel)) &&
          ['INGREDIENT', 'RAW_MATERIAL'].includes(row.product.productType),
      ).length,
      expiringBatches7Days: expiring,
      todayConsumptionCost: num(ingredientCost),
      todayWastageCost: num(wastage._sum.estimatedCost),
      todayFoodSales: num(foodSales),
      todayCompletedOrders: sales._count._all,
      foodCostPercentage: foodSales.greaterThan(0)
        ? ingredientCost.dividedBy(foodSales).times(100).toFixed(2)
        : '0.00',
      topConsumedIngredients: topConsumed.map((row) => ({
        product: nameById.get(row.productId) ?? row.productId,
        quantity: num(D(row._sum.quantityChange ?? 0).abs()),
        cost: num(D(row._sum.totalCost ?? 0).abs()),
      })),
    });
  }),
);

/** Sales-focused dashboard. */
dashboardRouter.get(
  '/ecommerce',
  requirePermission('report.view'),
  validate({ query: scope }),
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const today = startOfToday();
    const warehouseId = (req.query as z.infer<typeof scope>).warehouseId;

    const [orders, pending, todaySales, reserved, stock, topSelling] = await Promise.all([
      prisma.ecommerceOrder.count({ where: { organizationId } }),
      prisma.ecommerceOrder.count({
        where: { organizationId, status: { in: ['CREATED', 'PAYMENT_CONFIRMED', 'RESERVED', 'PACKED'] } },
      }),
      prisma.ecommerceOrder.aggregate({
        where: { organizationId, createdAt: { gte: today }, status: { not: 'CANCELLED' } },
        _sum: { grandTotal: true },
        _count: { _all: true },
      }),
      prisma.inventoryReservation.aggregate({
        where: { organizationId, status: 'ACTIVE', ...(warehouseId ? { warehouseId } : {}) },
        _sum: { quantity: true },
      }),
      prisma.inventoryStock.findMany({
        where: { organizationId, ...(warehouseId ? { warehouseId } : {}) },
        select: { quantity: true, product: { select: { reorderLevel: true } } },
      }),
      prisma.ecommerceOrderItem.groupBy({
        by: ['productId'],
        where: {
          order: {
            organizationId,
            status: { notIn: ['CREATED', 'CANCELLED'] },
            createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) },
          },
        },
        _sum: { quantity: true, total: true },
        orderBy: { _sum: { total: 'desc' } },
        take: 10,
      }),
    ]);

    const products = await prisma.product.findMany({
      where: { id: { in: topSelling.map((row) => row.productId) } },
      select: { id: true, name: true, sku: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    return ok(res, {
      totalOrders: orders,
      pendingOrders: pending,
      todaySales: num(todaySales._sum.grandTotal),
      todayOrders: todaySales._count._all,
      reservedQuantity: num(reserved._sum.quantity),
      lowStockCount: stock.filter(
        (row) =>
          D(row.quantity).greaterThan(0) &&
          D(row.quantity).lessThanOrEqualTo(D(row.product.reorderLevel)),
      ).length,
      outOfStockCount: stock.filter((row) => D(row.quantity).lessThanOrEqualTo(0)).length,
      topSellingProducts: topSelling.map((row) => ({
        product: byId.get(row.productId)?.name ?? row.productId,
        sku: byId.get(row.productId)?.sku ?? '',
        quantity: num(row._sum.quantity),
        revenue: num(row._sum.total),
      })),
    });
  }),
);

export default dashboardRouter;
