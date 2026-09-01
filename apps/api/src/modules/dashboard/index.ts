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

    const in30Days = new Date(Date.now() + 30 * 86_400_000);
    const [lowStockRows, expiringBatches, recentMovements] = await Promise.all([
      prisma.inventoryStock.findMany({
        where: { organizationId, product: { status: 'ACTIVE' } },
        select: {
          quantity: true,
          reservedQuantity: true,
          product: { select: { id: true, name: true, sku: true, reorderLevel: true } },
          warehouse: { select: { name: true } },
        },
        orderBy: { quantity: 'asc' },
        take: 60,
      }),
      prisma.inventoryBatch.findMany({
        where: { organizationId, quantity: { gt: 0 }, expiryDate: { not: null, lte: in30Days } },
        select: {
          id: true,
          batchNumber: true,
          expiryDate: true,
          quantity: true,
          product: { select: { name: true, sku: true } },
          warehouse: { select: { name: true } },
        },
        orderBy: { expiryDate: 'asc' },
        take: 8,
      }),
      prisma.inventoryLedger.findMany({
        where: { organizationId },
        select: {
          id: true,
          createdAt: true,
          transactionType: true,
          quantityChange: true,
          product: { select: { name: true, sku: true } },
          warehouse: { select: { name: true } },
          user: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
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
      lowStockItems: lowStockRows
        .filter((row) => D(row.quantity).lessThanOrEqualTo(D(row.product.reorderLevel)))
        .slice(0, 8)
        .map((row) => ({
          productId: row.product.id,
          product: row.product.name,
          sku: row.product.sku,
          warehouse: row.warehouse.name,
          quantity: num(row.quantity),
          reserved: num(row.reservedQuantity),
          reorderLevel: num(row.product.reorderLevel),
        })),
      expiringBatches: expiringBatches.map((row) => ({
        id: row.id,
        batchNumber: row.batchNumber,
        product: row.product.name,
        sku: row.product.sku,
        warehouse: row.warehouse.name,
        quantity: num(row.quantity),
        expiryDate: row.expiryDate,
      })),
      recentMovements: recentMovements.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        transactionType: row.transactionType,
        quantityChange: num(row.quantityChange),
        product: row.product.name,
        sku: row.product.sku,
        warehouse: row.warehouse.name,
        performer: row.user?.name ?? null,
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
