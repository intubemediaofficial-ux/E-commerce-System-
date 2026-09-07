import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { created, ok, pageMeta } from '../../lib/http';
import { notFound } from '../../lib/errors';
import { nonNegativeDecimal, orderBy, paginationSchema, skipTake, uuidParam } from '../../lib/query';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../middleware/asyncHandler';
import { orgId, requirePermission } from '../../middleware/auth';
import { auditFromRequest } from '../../services/audit.service';

const router = Router();

/** Accepts an absolute URL or a path served by the local `/uploads` mount. */
const imageReference = z
  .string()
  .trim()
  .max(500)
  .refine((value) => /^https?:\/\//.test(value) || value.startsWith('/uploads/'), {
    message: 'Image must be an absolute URL or an uploaded file path.',
  });

/**
 * A product carries six fields only: photo, title, cost price, warehouse/shop
 * name, date and the current stock quantity the team maintains by hand.
 */
const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  purchasePrice: nonNegativeDecimal.default(0),
  warehouseName: z.string().trim().max(160).nullable().optional(),
  stockDate: z.coerce.date().nullable().optional(),
  currentStock: nonNegativeDecimal.default(0),
  imageUrl: imageReference.nullable().optional(),
});

const SELECT = {
  id: true,
  name: true,
  imageUrl: true,
  purchasePrice: true,
  warehouseName: true,
  stockDate: true,
  currentStock: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * The catalogue keys the simplified panel never asks for are still required by
 * the database, so they are derived here.
 */
async function defaultUnitId(organizationId: string): Promise<string> {
  const existing = await prisma.unit.findFirst({
    where: { organizationId, code: 'PCS' },
    select: { id: true },
  });
  if (existing) return existing.id;
  const unit = await prisma.unit.create({
    data: { organizationId, code: 'PCS', name: 'Pieces', dimension: 'COUNT', isBase: true },
    select: { id: true },
  });
  return unit.id;
}

async function generateSku(organizationId: string, name: string): Promise<string> {
  const stem =
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 20) || 'PRODUCT';
  for (let attempt = 0; ; attempt += 1) {
    const candidate = attempt === 0 ? stem : `${stem}-${attempt + 1}`;
    const clash = await prisma.product.findFirst({
      where: { organizationId, sku: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
}

/**
 * Rows in the tables the register no longer exposes still point at products
 * and block deletion, so they are cleared alongside the product itself.
 */
async function purgeProducts(tx: Prisma.TransactionClient, ids: string[]): Promise<number> {
  const product = { productId: { in: ids } };
  await tx.inventoryLedger.deleteMany({ where: product });
  await tx.inventoryReservation.deleteMany({ where: product });
  await tx.inventoryBatch.deleteMany({ where: product });
  await tx.inventoryStock.deleteMany({ where: product });
  await tx.stockTransferItem.deleteMany({ where: product });
  await tx.stockAdjustmentItem.deleteMany({ where: product });
  await tx.wastage.deleteMany({ where: product });
  await tx.purchaseOrderItem.deleteMany({ where: product });
  await tx.goodsReceiptItem.deleteMany({ where: product });
  await tx.purchaseReturnItem.deleteMany({ where: product });
  await tx.ecommerceOrderItem.deleteMany({ where: product });
  await tx.restaurantOrderItem.deleteMany({ where: product });
  await tx.recipeItem.deleteMany({ where: { ingredientProductId: { in: ids } } });
  await tx.productBundleItem.deleteMany({ where: { componentProductId: { in: ids } } });
  await tx.supplierProduct.deleteMany({ where: product });
  await tx.productVariant.deleteMany({ where: product });
  const result = await tx.product.deleteMany({ where: { id: { in: ids } } });
  return result.count;
}

const SORTABLE = ['name', 'purchasePrice', 'currentStock', 'stockDate', 'createdAt'] as const;

const listQuery = paginationSchema.extend({
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
});

router.get(
  '/',
  requirePermission('product.view'),
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof listQuery>;
    const where = {
      organizationId: orgId(req),
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' as const } },
              { warehouseName: { contains: q.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.product.findMany({
        where,
        ...skipTake(q),
        orderBy: orderBy(q, SORTABLE, 'createdAt'),
        select: SELECT,
      }),
      prisma.product.count({ where }),
    ]);
    return ok(res, rows, pageMeta(q.page, q.perPage, total));
  }),
);

router.get(
  '/:id',
  requirePermission('product.view'),
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
      select: SELECT,
    });
    if (!product) throw notFound('PRODUCT_NOT_FOUND', 'Product not found.');
    return ok(res, product);
  }),
);

router.post(
  '/',
  requirePermission('product.create'),
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const body = req.body as z.infer<typeof createSchema>;
    const product = await prisma.product.create({
      data: {
        ...body,
        organizationId,
        sku: await generateSku(organizationId, body.name),
        unitId: await defaultUnitId(organizationId),
        stockDate: body.stockDate ?? new Date(),
      },
      select: SELECT,
    });
    await auditFromRequest(req, {
      action: 'PRODUCT_CREATED',
      module: 'product',
      entityType: 'Product',
      entityId: product.id,
      newValue: product,
    });
    return created(res, product);
  }),
);

router.put(
  '/:id',
  requirePermission('product.update'),
  validate({ params: uuidParam, body: createSchema.partial() }),
  asyncHandler(async (req, res) => {
    const existing = await prisma.product.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
      select: SELECT,
    });
    if (!existing) throw notFound('PRODUCT_NOT_FOUND', 'Product not found.');
    const product = await prisma.product.update({
      where: { id: existing.id },
      data: req.body,
      select: SELECT,
    });
    await auditFromRequest(req, {
      action: 'PRODUCT_UPDATED',
      module: 'product',
      entityType: 'Product',
      entityId: product.id,
      oldValue: existing,
      newValue: product,
    });
    return ok(res, product);
  }),
);

router.delete(
  '/:id',
  requirePermission('product.delete'),
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => {
    const existing = await prisma.product.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
      select: SELECT,
    });
    if (!existing) throw notFound('PRODUCT_NOT_FOUND', 'Product not found.');

    await prisma.$transaction((tx) => purgeProducts(tx, [existing.id]));
    await auditFromRequest(req, {
      action: 'PRODUCT_DELETED',
      module: 'product',
      entityType: 'Product',
      entityId: existing.id,
      oldValue: existing,
    });
    return ok(res, { id: existing.id, deleted: true });
  }),
);

router.post(
  '/bulk-delete',
  requirePermission('product.delete'),
  validate({ body: z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }) }),
  asyncHandler(async (req, res) => {
    const { ids } = req.body as { ids: string[] };
    const products = await prisma.product.findMany({
      where: { id: { in: ids }, organizationId: orgId(req) },
      select: { id: true, name: true },
    });
    if (products.length === 0) throw notFound('PRODUCT_NOT_FOUND', 'No matching products found.');

    const deleted = await prisma.$transaction((tx) =>
      purgeProducts(
        tx,
        products.map((product) => product.id),
      ),
    );
    await auditFromRequest(req, {
      action: 'PRODUCTS_BULK_DELETED',
      module: 'product',
      entityType: 'Product',
      oldValue: products,
    });
    return ok(res, { deleted });
  }),
);

export default router;
