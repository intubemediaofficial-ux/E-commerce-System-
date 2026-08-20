import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { D, ZERO } from '../../lib/decimal';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../middleware/asyncHandler';
import { orgId, requirePermission } from '../../middleware/auth';
import { sendReport, ExportFormat } from '../../services/export.service';

export const reportsRouter = Router();

const baseQuery = z.object({
  format: z.enum(['json', 'csv', 'excel', 'pdf']).default('json'),
  warehouseId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(10_000).default(2_000),
});

type BaseQuery = z.infer<typeof baseQuery>;

const q = (req: { query: unknown }): BaseQuery => req.query as BaseQuery;
const fmt = (value: BaseQuery['format']): ExportFormat => value;
const range = (query: BaseQuery): Prisma.DateTimeFilter | undefined =>
  query.from || query.to ? { gte: query.from, lte: query.to } : undefined;

const num = (value: Prisma.Decimal | number | string | null | undefined): string =>
  D(value ?? 0).toFixed(4);

// --------------------------------------------------------------- inventory ---

/** Current stock with reserved/available/value per product-warehouse row. */
reportsRouter.get(
  '/current-stock',
  requirePermission('report.view'),
  validate({ query: baseQuery }),
  asyncHandler(async (req, res) => {
    const query = q(req);
    const rows = await prisma.inventoryStock.findMany({
      where: {
        organizationId: orgId(req),
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        ...(query.productId ? { productId: query.productId } : {}),
        ...(query.categoryId ? { product: { categoryId: query.categoryId } } : {}),
      },
      take: query.limit,
      orderBy: { product: { name: 'asc' } },
      include: {
        product: { select: { name: true, sku: true, reorderLevel: true, category: { select: { name: true } } } },
        warehouse: { select: { name: true } },
      },
    });

    const data = rows.map((row) => ({
      product: row.product.name,
      sku: row.product.sku,
      category: row.product.category?.name ?? '',
      warehouse: row.warehouse.name,
      quantity: num(row.quantity),
      reserved: num(row.reservedQuantity),
      available: num(D(row.quantity).minus(D(row.reservedQuantity))),
      reorderLevel: num(row.product.reorderLevel),
      averageCost: num(row.averageCost),
      stockValue: num(D(row.quantity).times(D(row.averageCost))),
    }));

    await sendReport(res, fmt(query.format), 'Current Stock Report', [
      { header: 'Product', key: 'product', width: 30 },
      { header: 'SKU', key: 'sku' },
      { header: 'Category', key: 'category' },
      { header: 'Warehouse', key: 'warehouse' },
      { header: 'Quantity', key: 'quantity' },
      { header: 'Reserved', key: 'reserved' },
      { header: 'Available', key: 'available' },
      { header: 'Reorder Level', key: 'reorderLevel' },
      { header: 'Avg Cost', key: 'averageCost' },
      { header: 'Stock Value', key: 'stockValue' },
    ], data);
  }),
);

/** Immutable ledger extract — the audit trail of every stock movement. */
reportsRouter.get(
  '/stock-ledger',
  requirePermission('report.view'),
  validate({ query: baseQuery.extend({ transactionType: z.string().optional() }) }),
  asyncHandler(async (req, res) => {
    const query = q(req) as BaseQuery & { transactionType?: string };
    const rows = await prisma.inventoryLedger.findMany({
      where: {
        organizationId: orgId(req),
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        ...(query.productId ? { productId: query.productId } : {}),
        ...(query.transactionType
          ? { transactionType: query.transactionType as Prisma.EnumTransactionTypeFilter['equals'] }
          : {}),
        ...(range(query) ? { createdAt: range(query) } : {}),
      },
      take: query.limit,
      orderBy: { createdAt: 'desc' },
      include: {
        product: { select: { name: true, sku: true } },
        warehouse: { select: { name: true } },
        user: { select: { name: true } },
      },
    });

    const data = rows.map((row) => ({
      date: row.createdAt.toISOString(),
      product: row.product.name,
      sku: row.product.sku,
      warehouse: row.warehouse.name,
      type: row.transactionType,
      reference: `${row.referenceType ?? ''} ${row.referenceId ?? ''}`.trim(),
      before: num(row.quantityBefore),
      change: num(row.quantityChange),
      after: num(row.quantityAfter),
      unitCost: num(row.unitCost),
      totalCost: num(row.totalCost),
      user: row.user?.name ?? 'system',
    }));

    await sendReport(res, fmt(query.format), 'Stock Ledger Report', [
      { header: 'Date', key: 'date', width: 24 },
      { header: 'Product', key: 'product', width: 26 },
      { header: 'SKU', key: 'sku' },
      { header: 'Warehouse', key: 'warehouse' },
      { header: 'Type', key: 'type' },
      { header: 'Reference', key: 'reference', width: 28 },
      { header: 'Before', key: 'before' },
      { header: 'Change', key: 'change' },
      { header: 'After', key: 'after' },
      { header: 'Unit Cost', key: 'unitCost' },
      { header: 'Total Cost', key: 'totalCost' },
      { header: 'User', key: 'user' },
    ], data);
  }),
);

/** Valuation grouped by warehouse, category or product. */
reportsRouter.get(
  '/valuation',
  requirePermission('report.view'),
  validate({ query: baseQuery.extend({ groupBy: z.enum(['warehouse', 'category', 'product', 'batch']).default('warehouse') }) }),
  asyncHandler(async (req, res) => {
    const query = q(req) as BaseQuery & { groupBy: 'warehouse' | 'category' | 'product' | 'batch' };
    const organizationId = orgId(req);

    if (query.groupBy === 'batch') {
      const batches = await prisma.inventoryBatch.findMany({
        where: { organizationId, quantity: { gt: 0 }, ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}) },
        take: query.limit,
        include: { product: { select: { name: true, sku: true } }, warehouse: { select: { name: true } } },
        orderBy: { expiryDate: 'asc' },
      });
      const data = batches.map((batch) => ({
        group: `${batch.batchNumber} · ${batch.product.name}`,
        warehouse: batch.warehouse.name,
        quantity: num(batch.quantity),
        value: num(D(batch.quantity).times(D(batch.unitCost))),
        expiry: batch.expiryDate?.toISOString().slice(0, 10) ?? '',
      }));
      await sendReport(res, fmt(query.format), 'Inventory Valuation By Batch', [
        { header: 'Batch', key: 'group', width: 34 },
        { header: 'Warehouse', key: 'warehouse' },
        { header: 'Quantity', key: 'quantity' },
        { header: 'Value', key: 'value' },
        { header: 'Expiry', key: 'expiry' },
      ], data);
      return;
    }

    const stock = await prisma.inventoryStock.findMany({
      where: { organizationId, ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}) },
      include: {
        product: { select: { name: true, sku: true, category: { select: { name: true } } } },
        warehouse: { select: { name: true } },
      },
    });

    const groups = new Map<string, { quantity: Prisma.Decimal; value: Prisma.Decimal }>();
    for (const row of stock) {
      const key =
        query.groupBy === 'warehouse'
          ? row.warehouse.name
          : query.groupBy === 'category'
            ? (row.product.category?.name ?? 'Uncategorised')
            : `${row.product.name} (${row.product.sku})`;
      const current = groups.get(key) ?? { quantity: ZERO, value: ZERO };
      groups.set(key, {
        quantity: current.quantity.plus(D(row.quantity)),
        value: current.value.plus(D(row.quantity).times(D(row.averageCost))),
      });
    }

    const data = [...groups.entries()]
      .map(([group, totals]) => ({
        group,
        quantity: num(totals.quantity),
        value: num(totals.value),
      }))
      .sort((a, b) => Number(b.value) - Number(a.value));

    await sendReport(
      res,
      fmt(query.format),
      `Inventory Valuation By ${query.groupBy}`,
      [
        { header: query.groupBy, key: 'group', width: 34 },
        { header: 'Quantity', key: 'quantity' },
        { header: 'Value', key: 'value' },
      ],
      data,
      { totalValue: num(data.reduce((sum, row) => sum.plus(D(row.value)), ZERO)) },
    );
  }),
);

/** Low stock / out of stock, driven by each product's reorder level. */
reportsRouter.get(
  '/low-stock',
  requirePermission('report.view'),
  validate({ query: baseQuery.extend({ mode: z.enum(['low', 'out']).default('low') }) }),
  asyncHandler(async (req, res) => {
    const query = q(req) as BaseQuery & { mode: 'low' | 'out' };
    const rows = await prisma.inventoryStock.findMany({
      where: { organizationId: orgId(req), ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}) },
      include: {
        product: { select: { name: true, sku: true, reorderLevel: true } },
        warehouse: { select: { name: true } },
      },
      take: query.limit,
    });

    const data = rows
      .filter((row) =>
        query.mode === 'out'
          ? D(row.quantity).lessThanOrEqualTo(0)
          : D(row.quantity).greaterThan(0) &&
            D(row.quantity).lessThanOrEqualTo(D(row.product.reorderLevel)),
      )
      .map((row) => ({
        product: row.product.name,
        sku: row.product.sku,
        warehouse: row.warehouse.name,
        quantity: num(row.quantity),
        reorderLevel: num(row.product.reorderLevel),
        shortfall: num(D(row.product.reorderLevel).minus(D(row.quantity))),
      }));

    await sendReport(
      res,
      fmt(query.format),
      query.mode === 'out' ? 'Out Of Stock Report' : 'Low Stock Report',
      [
        { header: 'Product', key: 'product', width: 30 },
        { header: 'SKU', key: 'sku' },
        { header: 'Warehouse', key: 'warehouse' },
        { header: 'Quantity', key: 'quantity' },
        { header: 'Reorder Level', key: 'reorderLevel' },
        { header: 'Shortfall', key: 'shortfall' },
      ],
      data,
    );
  }),
);

reportsRouter.get(
  '/expiry',
  requirePermission('report.view'),
  validate({ query: baseQuery.extend({ days: z.coerce.number().int().min(0).max(365).default(30) }) }),
  asyncHandler(async (req, res) => {
    const query = q(req) as BaseQuery & { days: number };
    const until = new Date(Date.now() + query.days * 86_400_000);
    const rows = await prisma.inventoryBatch.findMany({
      where: {
        organizationId: orgId(req),
        quantity: { gt: 0 },
        expiryDate: { not: null, lte: until },
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      },
      take: query.limit,
      orderBy: { expiryDate: 'asc' },
      include: { product: { select: { name: true, sku: true } }, warehouse: { select: { name: true } } },
    });

    const today = new Date();
    const data = rows.map((row) => ({
      product: row.product.name,
      sku: row.product.sku,
      warehouse: row.warehouse.name,
      batch: row.batchNumber,
      expiry: row.expiryDate?.toISOString().slice(0, 10) ?? '',
      daysLeft: row.expiryDate
        ? Math.ceil((row.expiryDate.getTime() - today.getTime()) / 86_400_000)
        : '',
      quantity: num(row.quantity),
      value: num(D(row.quantity).times(D(row.unitCost))),
    }));

    await sendReport(res, fmt(query.format), 'Expiry Report', [
      { header: 'Product', key: 'product', width: 28 },
      { header: 'SKU', key: 'sku' },
      { header: 'Warehouse', key: 'warehouse' },
      { header: 'Batch', key: 'batch' },
      { header: 'Expiry', key: 'expiry' },
      { header: 'Days Left', key: 'daysLeft' },
      { header: 'Quantity', key: 'quantity' },
      { header: 'Value', key: 'value' },
    ], data);
  }),
);

reportsRouter.get(
  '/wastage',
  requirePermission('report.view'),
  validate({ query: baseQuery }),
  asyncHandler(async (req, res) => {
    const query = q(req);
    const rows = await prisma.wastage.findMany({
      where: {
        organizationId: orgId(req),
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        ...(query.productId ? { productId: query.productId } : {}),
        ...(range(query) ? { createdAt: range(query) } : {}),
      },
      take: query.limit,
      orderBy: { createdAt: 'desc' },
      include: {
        product: { select: { name: true, sku: true } },
        warehouse: { select: { name: true } },
      },
    });

    const data = rows.map((row) => ({
      date: row.createdAt.toISOString().slice(0, 19).replace('T', ' '),
      product: row.product.name,
      sku: row.product.sku,
      warehouse: row.warehouse.name,
      quantity: num(row.quantity),
      reason: row.reason,
      cost: num(row.estimatedCost),
      notes: row.notes ?? '',
    }));

    await sendReport(
      res,
      fmt(query.format),
      'Wastage Report',
      [
        { header: 'Date', key: 'date', width: 20 },
        { header: 'Product', key: 'product', width: 26 },
        { header: 'SKU', key: 'sku' },
        { header: 'Warehouse', key: 'warehouse' },
        { header: 'Quantity', key: 'quantity' },
        { header: 'Reason', key: 'reason' },
        { header: 'Cost', key: 'cost' },
        { header: 'Notes', key: 'notes', width: 30 },
      ],
      data,
      { totalCost: num(data.reduce((sum, row) => sum.plus(D(row.cost)), ZERO)) },
    );
  }),
);

reportsRouter.get(
  '/adjustments',
  requirePermission('report.view'),
  validate({ query: baseQuery }),
  asyncHandler(async (req, res) => {
    const query = q(req);
    const rows = await prisma.stockAdjustment.findMany({
      where: {
        organizationId: orgId(req),
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        ...(range(query) ? { createdAt: range(query) } : {}),
      },
      take: query.limit,
      orderBy: { createdAt: 'desc' },
      include: {
        warehouse: { select: { name: true } },
        items: { include: { product: { select: { name: true, sku: true } } } },
      },
    });

    const data = rows.flatMap((adjustment) =>
      adjustment.items.map((item) => ({
        date: adjustment.createdAt.toISOString().slice(0, 10),
        number: adjustment.adjustmentNumber,
        warehouse: adjustment.warehouse.name,
        reason: adjustment.reason,
        status: adjustment.status,
        product: item.product.name,
        sku: item.product.sku,
        change: num(item.quantityChange),
        unitCost: num(item.unitCost),
        value: num(D(item.quantityChange).times(D(item.unitCost))),
      })),
    );

    await sendReport(res, fmt(query.format), 'Inventory Adjustment Report', [
      { header: 'Date', key: 'date' },
      { header: 'Number', key: 'number' },
      { header: 'Warehouse', key: 'warehouse' },
      { header: 'Reason', key: 'reason' },
      { header: 'Status', key: 'status' },
      { header: 'Product', key: 'product', width: 26 },
      { header: 'SKU', key: 'sku' },
      { header: 'Change', key: 'change' },
      { header: 'Unit Cost', key: 'unitCost' },
      { header: 'Value', key: 'value' },
    ], data);
  }),
);

reportsRouter.get(
  '/transfers',
  requirePermission('report.view'),
  validate({ query: baseQuery }),
  asyncHandler(async (req, res) => {
    const query = q(req);
    const rows = await prisma.stockTransfer.findMany({
      where: { organizationId: orgId(req), ...(range(query) ? { createdAt: range(query) } : {}) },
      take: query.limit,
      orderBy: { createdAt: 'desc' },
      include: {
        sourceWarehouse: { select: { name: true } },
        destinationWarehouse: { select: { name: true } },
        items: { include: { product: { select: { name: true, sku: true } } } },
      },
    });

    const data = rows.flatMap((transfer) =>
      transfer.items.map((item) => ({
        date: transfer.createdAt.toISOString().slice(0, 10),
        number: transfer.transferNumber,
        status: transfer.status,
        source: transfer.sourceWarehouse.name,
        destination: transfer.destinationWarehouse.name,
        product: item.product.name,
        sku: item.product.sku,
        quantity: num(item.quantity),
        received: num(item.receivedQuantity),
        value: num(D(item.quantity).times(D(item.unitCost))),
      })),
    );

    await sendReport(res, fmt(query.format), 'Stock Transfer Report', [
      { header: 'Date', key: 'date' },
      { header: 'Number', key: 'number' },
      { header: 'Status', key: 'status' },
      { header: 'Source', key: 'source' },
      { header: 'Destination', key: 'destination' },
      { header: 'Product', key: 'product', width: 26 },
      { header: 'SKU', key: 'sku' },
      { header: 'Quantity', key: 'quantity' },
      { header: 'Received', key: 'received' },
      { header: 'Value', key: 'value' },
    ], data);
  }),
);

// -------------------------------------------------------------- purchasing ---

reportsRouter.get(
  '/purchases',
  requirePermission('report.view'),
  validate({ query: baseQuery }),
  asyncHandler(async (req, res) => {
    const query = q(req);
    const rows = await prisma.purchaseOrder.findMany({
      where: {
        organizationId: orgId(req),
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        ...(range(query) ? { orderDate: range(query) } : {}),
      },
      take: query.limit,
      orderBy: { orderDate: 'desc' },
      include: { supplier: { select: { name: true } }, warehouse: { select: { name: true } } },
    });

    const data = rows.map((row) => ({
      date: row.orderDate.toISOString().slice(0, 10),
      poNumber: row.poNumber,
      supplier: row.supplier.name,
      warehouse: row.warehouse.name,
      status: row.status,
      subtotal: num(row.subtotal),
      tax: num(row.taxTotal),
      discount: num(row.discountTotal),
      grandTotal: num(row.grandTotal),
    }));

    await sendReport(
      res,
      fmt(query.format),
      'Purchase Report',
      [
        { header: 'Date', key: 'date' },
        { header: 'PO Number', key: 'poNumber' },
        { header: 'Supplier', key: 'supplier', width: 26 },
        { header: 'Warehouse', key: 'warehouse' },
        { header: 'Status', key: 'status' },
        { header: 'Subtotal', key: 'subtotal' },
        { header: 'Tax', key: 'tax' },
        { header: 'Discount', key: 'discount' },
        { header: 'Grand Total', key: 'grandTotal' },
      ],
      data,
      { totalPurchases: num(data.reduce((sum, row) => sum.plus(D(row.grandTotal)), ZERO)) },
    );
  }),
);

reportsRouter.get(
  '/supplier-purchases',
  requirePermission('report.view'),
  validate({ query: baseQuery }),
  asyncHandler(async (req, res) => {
    const query = q(req);
    const grouped = await prisma.purchaseOrder.groupBy({
      by: ['supplierId'],
      where: {
        organizationId: orgId(req),
        status: { notIn: ['DRAFT', 'CANCELLED'] },
        ...(range(query) ? { orderDate: range(query) } : {}),
      },
      _sum: { grandTotal: true },
      _count: { _all: true },
    });
    const suppliers = await prisma.supplier.findMany({
      where: { id: { in: grouped.map((g) => g.supplierId) } },
      select: { id: true, name: true, companyName: true },
    });
    const nameById = new Map(suppliers.map((s) => [s.id, s.companyName ?? s.name]));

    const data = grouped
      .map((row) => ({
        supplier: nameById.get(row.supplierId) ?? row.supplierId,
        orders: row._count._all,
        totalValue: num(row._sum.grandTotal),
      }))
      .sort((a, b) => Number(b.totalValue) - Number(a.totalValue));

    await sendReport(res, fmt(query.format), 'Supplier Purchase Report', [
      { header: 'Supplier', key: 'supplier', width: 34 },
      { header: 'Orders', key: 'orders' },
      { header: 'Total Value', key: 'totalValue' },
    ], data);
  }),
);

reportsRouter.get(
  '/purchase-returns',
  requirePermission('report.view'),
  validate({ query: baseQuery }),
  asyncHandler(async (req, res) => {
    const query = q(req);
    const rows = await prisma.purchaseReturn.findMany({
      where: {
        organizationId: orgId(req),
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
        ...(range(query) ? { createdAt: range(query) } : {}),
      },
      take: query.limit,
      orderBy: { createdAt: 'desc' },
      include: {
        supplier: { select: { name: true } },
        items: { include: { product: { select: { name: true, sku: true } } } },
      },
    });

    const data = rows.flatMap((ret) =>
      ret.items.map((item) => ({
        date: ret.createdAt.toISOString().slice(0, 10),
        number: ret.returnNumber,
        supplier: ret.supplier.name,
        product: item.product.name,
        sku: item.product.sku,
        quantity: num(item.quantity),
        unitCost: num(item.unitCost),
        value: num(D(item.quantity).times(D(item.unitCost))),
        reason: ret.reason ?? '',
      })),
    );

    await sendReport(res, fmt(query.format), 'Purchase Return Report', [
      { header: 'Date', key: 'date' },
      { header: 'Number', key: 'number' },
      { header: 'Supplier', key: 'supplier', width: 26 },
      { header: 'Product', key: 'product', width: 26 },
      { header: 'SKU', key: 'sku' },
      { header: 'Quantity', key: 'quantity' },
      { header: 'Unit Cost', key: 'unitCost' },
      { header: 'Value', key: 'value' },
      { header: 'Reason', key: 'reason', width: 26 },
    ], data);
  }),
);

/** Purchase price history for a product — shows cost inflation over time. */
reportsRouter.get(
  '/price-history',
  requirePermission('report.view'),
  validate({ query: baseQuery.extend({ productId: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const query = q(req) as BaseQuery & { productId: string };
    const rows = await prisma.goodsReceiptItem.findMany({
      where: {
        productId: query.productId,
        goodsReceipt: {
          organizationId: orgId(req),
          ...(range(query) ? { receivedDate: range(query) } : {}),
        },
      },
      take: query.limit,
      orderBy: { goodsReceipt: { receivedDate: 'asc' } },
      include: {
        goodsReceipt: { include: { supplier: { select: { name: true } } } },
        product: { select: { name: true, sku: true } },
      },
    });

    const data = rows.map((row) => ({
      date: row.goodsReceipt.receivedDate.toISOString().slice(0, 10),
      grn: row.goodsReceipt.grnNumber,
      supplier: row.goodsReceipt.supplier.name,
      product: row.product.name,
      quantity: num(row.quantity),
      unitCost: num(row.unitCost),
    }));

    await sendReport(res, fmt(query.format), 'Purchase Price History', [
      { header: 'Date', key: 'date' },
      { header: 'GRN', key: 'grn' },
      { header: 'Supplier', key: 'supplier', width: 26 },
      { header: 'Product', key: 'product', width: 26 },
      { header: 'Quantity', key: 'quantity' },
      { header: 'Unit Cost', key: 'unitCost' },
    ], data);
  }),
);

// -------------------------------------------------------------- restaurant ---

reportsRouter.get(
  '/consumption',
  requirePermission('report.view'),
  validate({ query: baseQuery }),
  asyncHandler(async (req, res) => {
    const query = q(req);
    const grouped = await prisma.inventoryLedger.groupBy({
      by: ['productId'],
      where: {
        organizationId: orgId(req),
        transactionType: 'CONSUMPTION',
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        ...(range(query) ? { createdAt: range(query) } : {}),
      },
      _sum: { quantityChange: true, totalCost: true },
    });
    const products = await prisma.product.findMany({
      where: { id: { in: grouped.map((g) => g.productId) } },
      select: { id: true, name: true, sku: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const data = grouped
      .map((row) => ({
        product: byId.get(row.productId)?.name ?? row.productId,
        sku: byId.get(row.productId)?.sku ?? '',
        quantity: num(D(row._sum.quantityChange ?? 0).abs()),
        cost: num(D(row._sum.totalCost ?? 0).abs()),
      }))
      .sort((a, b) => Number(b.cost) - Number(a.cost));

    await sendReport(
      res,
      fmt(query.format),
      'Ingredient Consumption Report',
      [
        { header: 'Product', key: 'product', width: 30 },
        { header: 'SKU', key: 'sku' },
        { header: 'Quantity Consumed', key: 'quantity' },
        { header: 'Cost', key: 'cost' },
      ],
      data,
      { totalCost: num(data.reduce((sum, row) => sum.plus(D(row.cost)), ZERO)) },
    );
  }),
);

/** Food cost % = ingredient consumption cost / food sales x 100. */
reportsRouter.get(
  '/food-cost',
  requirePermission('report.view'),
  validate({ query: baseQuery }),
  asyncHandler(async (req, res) => {
    const query = q(req);
    const organizationId = orgId(req);
    const where = {
      organizationId,
      status: 'COMPLETED' as const,
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(range(query) ? { consumedAt: range(query) } : {}),
    };

    const [orders, consumption] = await Promise.all([
      prisma.restaurantOrder.aggregate({ where, _sum: { totalAmount: true }, _count: { _all: true } }),
      prisma.inventoryLedger.aggregate({
        where: {
          organizationId,
          transactionType: 'CONSUMPTION',
          referenceType: 'RESTAURANT_ORDER',
          ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
          ...(range(query) ? { createdAt: range(query) } : {}),
        },
        _sum: { totalCost: true },
      }),
    ]);

    const sales = D(orders._sum.totalAmount ?? 0);
    const cost = D(consumption._sum.totalCost ?? 0).abs();
    const data = [
      {
        metric: 'Food sales',
        value: num(sales),
      },
      { metric: 'Ingredient cost', value: num(cost) },
      {
        metric: 'Food cost %',
        value: sales.greaterThan(0) ? cost.dividedBy(sales).times(100).toFixed(2) : '0.00',
      },
      { metric: 'Completed orders', value: String(orders._count._all) },
    ];

    await sendReport(res, fmt(query.format), 'Food Cost Report', [
      { header: 'Metric', key: 'metric', width: 28 },
      { header: 'Value', key: 'value', width: 20 },
    ], data);
  }),
);

reportsRouter.get(
  '/recipe-cost',
  requirePermission('report.view'),
  validate({ query: baseQuery }),
  asyncHandler(async (req, res) => {
    const query = q(req);
    const organizationId = orgId(req);
    const recipes = await prisma.recipe.findMany({
      where: { organizationId, status: 'ACTIVE' },
      take: query.limit,
      include: {
        product: { select: { name: true, sellingPrice: true } },
        items: { include: { ingredientProduct: { select: { id: true } } } },
      },
    });

    const ingredientIds = [
      ...new Set(recipes.flatMap((r) => r.items.map((i) => i.ingredientProductId))),
    ];
    const costs = await prisma.inventoryStock.groupBy({
      by: ['productId'],
      where: { organizationId, productId: { in: ingredientIds } },
      _avg: { averageCost: true },
    });
    const costById = new Map(costs.map((c) => [c.productId, D(c._avg.averageCost ?? 0)]));

    const data = recipes.map((recipe) => {
      const total = recipe.items.reduce(
        (sum, item) =>
          sum.plus(
            D(item.quantity)
              .times(D(1).plus(D(item.wastagePercentage).dividedBy(100)))
              .times(costById.get(item.ingredientProductId) ?? ZERO),
          ),
        ZERO,
      );
      const yieldQty = D(recipe.yieldQuantity);
      const perUnit = yieldQty.greaterThan(0) ? total.dividedBy(yieldQty) : ZERO;
      const price = D(recipe.product.sellingPrice);
      return {
        recipe: recipe.name,
        product: recipe.product.name,
        yieldQuantity: num(yieldQty),
        totalCost: num(total),
        costPerUnit: num(perUnit),
        sellingPrice: num(price),
        marginPercent: price.greaterThan(0)
          ? price.minus(perUnit).dividedBy(price).times(100).toFixed(2)
          : '0.00',
      };
    });

    await sendReport(res, fmt(query.format), 'Recipe Cost Report', [
      { header: 'Recipe', key: 'recipe', width: 28 },
      { header: 'Product', key: 'product', width: 26 },
      { header: 'Yield', key: 'yieldQuantity' },
      { header: 'Total Cost', key: 'totalCost' },
      { header: 'Cost / Unit', key: 'costPerUnit' },
      { header: 'Selling Price', key: 'sellingPrice' },
      { header: 'Margin %', key: 'marginPercent' },
    ], data);
  }),
);

// --------------------------------------------------------------- ecommerce ---

reportsRouter.get(
  '/sales',
  requirePermission('report.view'),
  validate({ query: baseQuery }),
  asyncHandler(async (req, res) => {
    const query = q(req);
    const rows = await prisma.ecommerceOrder.findMany({
      where: {
        organizationId: orgId(req),
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        ...(range(query) ? { createdAt: range(query) } : {}),
      },
      take: query.limit,
      orderBy: { createdAt: 'desc' },
      include: { warehouse: { select: { name: true } } },
    });

    const data = rows.map((row) => ({
      date: row.createdAt.toISOString().slice(0, 10),
      orderNumber: row.orderNumber,
      customer: row.customerName ?? '',
      warehouse: row.warehouse.name,
      status: row.status,
      subtotal: num(row.subtotal),
      tax: num(row.taxTotal),
      grandTotal: num(row.grandTotal),
    }));

    await sendReport(
      res,
      fmt(query.format),
      'E-commerce Sales Report',
      [
        { header: 'Date', key: 'date' },
        { header: 'Order', key: 'orderNumber' },
        { header: 'Customer', key: 'customer', width: 26 },
        { header: 'Warehouse', key: 'warehouse' },
        { header: 'Status', key: 'status' },
        { header: 'Subtotal', key: 'subtotal' },
        { header: 'Tax', key: 'tax' },
        { header: 'Grand Total', key: 'grandTotal' },
      ],
      data,
      { totalSales: num(data.reduce((sum, row) => sum.plus(D(row.grandTotal)), ZERO)) },
    );
  }),
);

reportsRouter.get(
  '/product-sales',
  requirePermission('report.view'),
  validate({ query: baseQuery }),
  asyncHandler(async (req, res) => {
    const query = q(req);
    const grouped = await prisma.ecommerceOrderItem.groupBy({
      by: ['productId'],
      where: {
        order: {
          organizationId: orgId(req),
          status: { notIn: ['CREATED', 'CANCELLED'] },
          ...(range(query) ? { createdAt: range(query) } : {}),
        },
      },
      _sum: { quantity: true, total: true },
    });
    const products = await prisma.product.findMany({
      where: { id: { in: grouped.map((g) => g.productId) } },
      select: { id: true, name: true, sku: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const data = grouped
      .map((row) => ({
        product: byId.get(row.productId)?.name ?? row.productId,
        sku: byId.get(row.productId)?.sku ?? '',
        quantitySold: num(row._sum.quantity),
        revenue: num(row._sum.total),
      }))
      .sort((a, b) => Number(b.revenue) - Number(a.revenue));

    await sendReport(res, fmt(query.format), 'Product Sales Report', [
      { header: 'Product', key: 'product', width: 30 },
      { header: 'SKU', key: 'sku' },
      { header: 'Quantity Sold', key: 'quantitySold' },
      { header: 'Revenue', key: 'revenue' },
    ], data);
  }),
);

/** Fast/slow movers and dead stock based on ledger outflow. */
reportsRouter.get(
  '/stock-movement',
  requirePermission('report.view'),
  validate({ query: baseQuery }),
  asyncHandler(async (req, res) => {
    const query = q(req);
    const organizationId = orgId(req);
    const grouped = await prisma.inventoryLedger.groupBy({
      by: ['productId'],
      where: {
        organizationId,
        transactionType: { in: ['SALE', 'CONSUMPTION'] },
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        ...(range(query) ? { createdAt: range(query) } : {}),
      },
      _sum: { quantityChange: true },
      _count: { _all: true },
    });
    const movementById = new Map(
      grouped.map((row) => [
        row.productId,
        { outflow: D(row._sum.quantityChange ?? 0).abs(), movements: row._count._all },
      ]),
    );

    const stock = await prisma.inventoryStock.groupBy({
      by: ['productId'],
      where: { organizationId, ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}) },
      _sum: { quantity: true },
    });
    const products = await prisma.product.findMany({
      where: { organizationId, status: 'ACTIVE' },
      select: { id: true, name: true, sku: true },
      take: query.limit,
    });

    const stockById = new Map(stock.map((s) => [s.productId, D(s._sum.quantity ?? 0)]));

    const data = products
      .map((product) => {
        const movement = movementById.get(product.id);
        const outflow = movement?.outflow ?? ZERO;
        const onHand = stockById.get(product.id) ?? ZERO;
        const turnover = onHand.greaterThan(0) ? outflow.dividedBy(onHand) : ZERO;
        return {
          product: product.name,
          sku: product.sku,
          onHand: num(onHand),
          outflow: num(outflow),
          movements: movement?.movements ?? 0,
          turnover: turnover.toFixed(2),
          classification:
            outflow.equals(0) && onHand.greaterThan(0)
              ? 'DEAD_STOCK'
              : turnover.greaterThanOrEqualTo(1)
                ? 'FAST_MOVING'
                : 'SLOW_MOVING',
        };
      })
      .sort((a, b) => Number(b.outflow) - Number(a.outflow));

    await sendReport(res, fmt(query.format), 'Stock Movement Report', [
      { header: 'Product', key: 'product', width: 30 },
      { header: 'SKU', key: 'sku' },
      { header: 'On Hand', key: 'onHand' },
      { header: 'Outflow', key: 'outflow' },
      { header: 'Movements', key: 'movements' },
      { header: 'Turnover', key: 'turnover' },
      { header: 'Classification', key: 'classification' },
    ], data);
  }),
);

reportsRouter.get(
  '/audit',
  requirePermission('audit.view'),
  validate({ query: baseQuery.extend({ module: z.string().optional() }) }),
  asyncHandler(async (req, res) => {
    const query = q(req) as BaseQuery & { module?: string };
    const rows = await prisma.auditLog.findMany({
      where: {
        organizationId: orgId(req),
        ...(query.module ? { module: query.module } : {}),
        ...(range(query) ? { createdAt: range(query) } : {}),
      },
      take: query.limit,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { name: true, email: true } } },
    });

    const data = rows.map((row) => ({
      date: row.createdAt.toISOString(),
      user: row.user?.email ?? 'system',
      action: row.action,
      module: row.module,
      entityType: row.entityType ?? '',
      entityId: row.entityId ?? '',
      ip: row.ip ?? '',
    }));

    await sendReport(res, fmt(query.format), 'Audit Report', [
      { header: 'Date', key: 'date', width: 24 },
      { header: 'User', key: 'user', width: 26 },
      { header: 'Action', key: 'action', width: 26 },
      { header: 'Module', key: 'module' },
      { header: 'Entity', key: 'entityType' },
      { header: 'Entity Id', key: 'entityId', width: 30 },
      { header: 'IP', key: 'ip' },
    ], data);
  }),
);

export default reportsRouter;
