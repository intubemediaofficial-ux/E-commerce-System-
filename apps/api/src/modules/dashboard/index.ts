import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { ok } from '../../lib/http';
import { D, ZERO } from '../../lib/decimal';
import { asyncHandler } from '../../middleware/asyncHandler';
import { orgId, requirePermission } from '../../middleware/auth';

export const dashboardRouter = Router();

/** Catalogue overview: product count, stock on hand and its purchase value. */
dashboardRouter.get(
  '/summary',
  requirePermission('product.view'),
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const where = { organizationId, status: 'ACTIVE' as const };

    const [totalProducts, products, recentProducts] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({ where, select: { currentStock: true, purchasePrice: true } }),
      prisma.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true,
          name: true,
          imageUrl: true,
          purchasePrice: true,
          warehouseName: true,
          stockDate: true,
          currentStock: true,
          createdAt: true,
        },
      }),
    ]);

    let totalStockUnits = ZERO;
    let totalPurchaseValue = ZERO;
    for (const product of products) {
      totalStockUnits = totalStockUnits.plus(D(product.currentStock));
      totalPurchaseValue = totalPurchaseValue.plus(
        D(product.currentStock).times(D(product.purchasePrice)),
      );
    }

    return ok(res, {
      totalProducts,
      totalStockUnits: totalStockUnits.toFixed(2),
      totalPurchaseValue: totalPurchaseValue.toFixed(2),
      recentProducts,
    });
  }),
);

export default dashboardRouter;
