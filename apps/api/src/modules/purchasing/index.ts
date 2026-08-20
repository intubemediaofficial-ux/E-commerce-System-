import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { ok } from '../../lib/http';
import { notFound } from '../../lib/errors';
import { D, ZERO } from '../../lib/decimal';
import { uuidParam } from '../../lib/query';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../middleware/asyncHandler';
import { orgId, requirePermission } from '../../middleware/auth';
import purchaseOrdersRouter from './purchaseOrders.routes';
import purchaseReturnsRouter from './purchaseReturns.routes';

export const purchasingRouter = Router();

purchasingRouter.use('/purchase-orders', purchaseOrdersRouter);
purchasingRouter.use('/purchase-returns', purchaseReturnsRouter);

/** Supplier history: purchases, receipts, returns and outstanding balance. */
purchasingRouter.get(
  '/suppliers/:id/history',
  requirePermission('supplier.view'),
  validate({ params: uuidParam, query: z.object({}).passthrough() }),
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const supplier = await prisma.supplier.findFirst({
      where: { id: req.params.id, organizationId },
    });
    if (!supplier) throw notFound('SUPPLIER_NOT_FOUND', 'Supplier not found.');

    const [orders, receipts, returns, products] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where: { organizationId, supplierId: supplier.id },
        orderBy: { orderDate: 'desc' },
        take: 50,
        select: {
          id: true,
          poNumber: true,
          orderDate: true,
          status: true,
          grandTotal: true,
        },
      }),
      prisma.goodsReceipt.findMany({
        where: { organizationId, supplierId: supplier.id },
        orderBy: { receivedDate: 'desc' },
        take: 50,
        select: { id: true, grnNumber: true, receivedDate: true, invoiceNumber: true },
      }),
      prisma.purchaseReturn.findMany({
        where: { organizationId, supplierId: supplier.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, returnNumber: true, createdAt: true, totalValue: true },
      }),
      prisma.supplierProduct.findMany({
        where: { supplierId: supplier.id },
        include: { product: { select: { id: true, name: true, sku: true } } },
      }),
    ]);

    const purchased = orders
      .filter((o) => !['DRAFT', 'CANCELLED'].includes(o.status))
      .reduce((sum, o) => sum.plus(D(o.grandTotal)), ZERO);
    const returned = returns.reduce((sum, r) => sum.plus(D(r.totalValue)), ZERO);

    return ok(res, {
      supplier,
      totals: {
        purchaseValue: purchased.toFixed(2),
        returnValue: returned.toFixed(2),
        netValue: purchased.minus(returned).toFixed(2),
        creditLimit: D(supplier.creditLimit).toFixed(2),
      },
      orders,
      receipts,
      returns,
      products,
    });
  }),
);

export default purchasingRouter;
