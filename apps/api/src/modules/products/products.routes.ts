import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { created, ok, pageMeta } from '../../lib/http';
import { badRequest, notFound } from '../../lib/errors';
import {
  nonNegativeDecimal,
  orderBy,
  paginationSchema,
  positiveDecimal,
  skipTake,
  uuidParam,
} from '../../lib/query';
import { parseCsv } from '../../lib/csv';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../middleware/asyncHandler';
import { orgId, requirePermission } from '../../middleware/auth';
import { auditFromRequest } from '../../services/audit.service';
import { Column, ExportFormat, sendReport } from '../../services/export.service';

const router = Router();

const PRODUCT_TYPES = [
  'FINISHED_PRODUCT',
  'RAW_MATERIAL',
  'INGREDIENT',
  'PACKAGING_MATERIAL',
  'SERVICE',
  'BUNDLE',
] as const;

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  sku: z.string().trim().min(1).max(60),
  barcode: z.string().trim().max(60).nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  brandId: z.string().uuid().nullable().optional(),
  description: z.string().trim().max(2000).optional(),
  productType: z.enum(PRODUCT_TYPES).default('FINISHED_PRODUCT'),
  unitId: z.string().uuid(),
  purchasePrice: nonNegativeDecimal.default(0),
  sellingPrice: nonNegativeDecimal.default(0),
  taxRate: nonNegativeDecimal.default(0),
  reorderLevel: nonNegativeDecimal.default(0),
  minimumStockLevel: nonNegativeDecimal.default(0),
  maximumStockLevel: nonNegativeDecimal.nullable().optional(),
  trackBatches: z.boolean().default(false),
  isPerishable: z.boolean().default(false),
  shelfLifeDays: z.coerce.number().int().positive().nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
});

const exportFormat = z.enum(['json', 'csv', 'excel', 'pdf']).default('csv');

interface ProductExportRow extends Record<string, string> {
  sku: string;
  name: string;
}

const PRODUCT_EXPORT_COLUMNS: Column<ProductExportRow>[] = [
  { header: 'SKU', key: 'sku' },
  { header: 'Name', key: 'name', width: 32 },
  { header: 'Barcode', key: 'barcode' },
  { header: 'Type', key: 'productType' },
  { header: 'Unit', key: 'unit', width: 10 },
  { header: 'Category', key: 'category' },
  { header: 'Brand', key: 'brand' },
  { header: 'Purchase Price', key: 'purchasePrice' },
  { header: 'Selling Price', key: 'sellingPrice' },
  { header: 'Tax Rate', key: 'taxRate' },
  { header: 'Reorder Level', key: 'reorderLevel' },
  { header: 'Status', key: 'status' },
];

const csvBoolean = z
  .string()
  .optional()
  .transform((value) => ['1', 'true', 'yes', 'y'].includes((value ?? '').toLowerCase()));

const csvNumber = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value === '' ? '0' : value))
  .refine((value) => Number.isFinite(Number(value)) && Number(value) >= 0, {
    message: 'Numeric columns must be zero or greater.',
  });

const importRowSchema = z.object({
  sku: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(200),
  barcode: z.string().trim().max(60).optional().default(''),
  productType: z.enum(PRODUCT_TYPES).default('FINISHED_PRODUCT'),
  unit: z.string().trim().min(1),
  category: z.string().trim().optional().default(''),
  brand: z.string().trim().optional().default(''),
  purchasePrice: csvNumber,
  sellingPrice: csvNumber,
  taxRate: csvNumber,
  reorderLevel: csvNumber,
  trackBatches: csvBoolean,
  isPerishable: csvBoolean,
});

const SORTABLE = ['name', 'sku', 'sellingPrice', 'purchasePrice', 'createdAt', 'updatedAt'] as const;

const listQuery = paginationSchema.extend({
  categoryId: z.string().uuid().optional(),
  brandId: z.string().uuid().optional(),
  productType: z.enum(PRODUCT_TYPES).optional(),
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
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.brandId ? { brandId: q.brandId } : {}),
      ...(q.productType ? { productType: q.productType } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' as const } },
              { sku: { contains: q.search, mode: 'insensitive' as const } },
              { barcode: { contains: q.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.product.findMany({
        where,
        ...skipTake(q),
        orderBy: orderBy(q, SORTABLE, 'name'),
        include: {
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          unit: { select: { id: true, code: true, name: true } },
          stock: { select: { warehouseId: true, quantity: true, reservedQuantity: true } },
        },
      }),
      prisma.product.count({ where }),
    ]);
    return ok(res, rows, pageMeta(q.page, q.perPage, total));
  }),
);

/** Scanner friendly lookup: resolves a SKU or barcode on either a product or a variant. */
router.get(
  '/lookup',
  requirePermission('product.view'),
  validate({ query: z.object({ code: z.string().trim().min(1).max(60) }) }),
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const code = (req.query as { code: string }).code;

    const product = await prisma.product.findFirst({
      where: { organizationId, OR: [{ sku: code }, { barcode: code }] },
      include: {
        unit: { select: { id: true, code: true, name: true } },
        stock: { include: { warehouse: { select: { id: true, name: true, code: true } } } },
      },
    });
    if (product) return ok(res, { product, variant: null });

    const variant = await prisma.productVariant.findFirst({
      where: { product: { organizationId }, OR: [{ sku: code }, { barcode: code }] },
      include: {
        product: { include: { unit: { select: { id: true, code: true, name: true } } } },
        stock: { include: { warehouse: { select: { id: true, name: true, code: true } } } },
      },
    });
    if (!variant) throw notFound('PRODUCT_NOT_FOUND', 'No product or variant matches this code.');
    return ok(res, { product: variant.product, variant });
  }),
);

router.get(
  '/export',
  requirePermission('product.view'),
  validate({ query: z.object({ format: exportFormat }) }),
  asyncHandler(async (req, res) => {
    const rows = await prisma.product.findMany({
      where: { organizationId: orgId(req) },
      orderBy: { sku: 'asc' },
      include: {
        unit: { select: { code: true } },
        category: { select: { name: true } },
        brand: { select: { name: true } },
      },
    });
    await sendReport(
      res,
      (req.query as { format: ExportFormat }).format,
      'Products',
      PRODUCT_EXPORT_COLUMNS,
      rows.map((row) => ({
        sku: row.sku,
        name: row.name,
        barcode: row.barcode ?? '',
        productType: row.productType,
        unit: row.unit.code,
        category: row.category?.name ?? '',
        brand: row.brand?.name ?? '',
        purchasePrice: row.purchasePrice.toFixed(2),
        sellingPrice: row.sellingPrice.toFixed(2),
        taxRate: row.taxRate.toFixed(2),
        reorderLevel: row.reorderLevel.toFixed(4),
        status: row.status,
      })),
    );
  }),
);

/**
 * Bulk product upsert from CSV. Rows are keyed by SKU inside the organization so
 * the same file can be replayed to correct pricing or stock thresholds.
 */
router.post(
  '/import',
  requirePermission('product.create'),
  validate({ body: z.object({ csv: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const rows = parseCsv((req.body as { csv: string }).csv);
    const [units, categories, brands] = await Promise.all([
      prisma.unit.findMany({ where: { organizationId }, select: { id: true, code: true } }),
      prisma.category.findMany({ where: { organizationId }, select: { id: true, name: true } }),
      prisma.brand.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    ]);
    const unitByCode = new Map(units.map((unit) => [unit.code.toUpperCase(), unit.id]));
    const categoryByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
    const brandByName = new Map(brands.map((b) => [b.name.toLowerCase(), b.id]));

    const errors: { row: number; message: string }[] = [];
    let createdCount = 0;
    let updatedCount = 0;

    for (const [index, row] of rows.entries()) {
      const parsed = importRowSchema.safeParse(row);
      if (!parsed.success) {
        errors.push({ row: index + 2, message: parsed.error.issues[0].message });
        continue;
      }
      const unitId = unitByCode.get(parsed.data.unit.toUpperCase());
      if (!unitId) {
        errors.push({ row: index + 2, message: `Unknown unit "${parsed.data.unit}".` });
        continue;
      }

      const data = {
        name: parsed.data.name,
        barcode: parsed.data.barcode || null,
        productType: parsed.data.productType,
        unitId,
        categoryId: parsed.data.category
          ? categoryByName.get(parsed.data.category.toLowerCase()) ?? null
          : null,
        brandId: parsed.data.brand ? brandByName.get(parsed.data.brand.toLowerCase()) ?? null : null,
        purchasePrice: parsed.data.purchasePrice,
        sellingPrice: parsed.data.sellingPrice,
        taxRate: parsed.data.taxRate,
        reorderLevel: parsed.data.reorderLevel,
        trackBatches: parsed.data.trackBatches,
        isPerishable: parsed.data.isPerishable,
      };

      const existing = await prisma.product.findFirst({
        where: { organizationId, sku: parsed.data.sku },
        select: { id: true },
      });
      if (existing) {
        await prisma.product.update({ where: { id: existing.id }, data });
        updatedCount += 1;
      } else {
        await prisma.product.create({ data: { ...data, organizationId, sku: parsed.data.sku } });
        createdCount += 1;
      }
    }

    await auditFromRequest(req, {
      action: 'PRODUCT_BULK_IMPORT',
      module: 'product',
      entityType: 'Product',
      newValue: { created: createdCount, updated: updatedCount, failed: errors.length },
    });
    return ok(res, { created: createdCount, updated: updatedCount, errors });
  }),
);

router.get(
  '/:id',
  requirePermission('product.view'),
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
      include: {
        category: true,
        brand: true,
        unit: true,
        variants: true,
        stock: { include: { warehouse: { select: { id: true, name: true, type: true } } } },
        batches: { where: { quantity: { gt: 0 } }, orderBy: { expiryDate: 'asc' } },
        recipes: { include: { items: true } },
      },
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
    const unit = await prisma.unit.findFirst({ where: { id: req.body.unitId, organizationId } });
    if (!unit) throw badRequest('VALIDATION_ERROR', 'Unit does not belong to this organization.');
    const product = await prisma.product.create({ data: { ...req.body, organizationId } });
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
    });
    if (!existing) throw notFound('PRODUCT_NOT_FOUND', 'Product not found.');
    const product = await prisma.product.update({ where: { id: existing.id }, data: req.body });
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
      include: { stock: true },
    });
    if (!existing) throw notFound('PRODUCT_NOT_FOUND', 'Product not found.');
    const hasStock = existing.stock.some((s) => Number(s.quantity) !== 0);
    if (hasStock) {
      throw badRequest('VALIDATION_ERROR', 'Products holding stock cannot be archived.');
    }
    const product = await prisma.product.update({
      where: { id: existing.id },
      data: { status: 'ARCHIVED' },
    });
    await auditFromRequest(req, {
      action: 'PRODUCT_ARCHIVED',
      module: 'product',
      entityType: 'Product',
      entityId: product.id,
      oldValue: existing,
      newValue: product,
    });
    return ok(res, product);
  }),
);

// ---------------------------------------------------------------- variants ---

const variantSchema = z.object({
  name: z.string().trim().min(1).max(160),
  sku: z.string().trim().min(1).max(60),
  barcode: z.string().trim().max(60).nullable().optional(),
  attributes: z.record(z.string()).default({}),
  price: nonNegativeDecimal.nullable().optional(),
  weight: nonNegativeDecimal.nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
});

router.get(
  '/:id/variants',
  requirePermission('product.view'),
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
      select: { id: true },
    });
    if (!product) throw notFound('PRODUCT_NOT_FOUND', 'Product not found.');
    const variants = await prisma.productVariant.findMany({
      where: { productId: product.id },
      include: { stock: true },
      orderBy: { name: 'asc' },
    });
    return ok(res, variants);
  }),
);

router.post(
  '/:id/variants',
  requirePermission('product.update'),
  validate({ params: uuidParam, body: variantSchema }),
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
      select: { id: true },
    });
    if (!product) throw notFound('PRODUCT_NOT_FOUND', 'Product not found.');
    const variant = await prisma.productVariant.create({
      data: { ...req.body, productId: product.id },
    });
    await auditFromRequest(req, {
      action: 'PRODUCT_VARIANT_CREATED',
      module: 'product',
      entityType: 'ProductVariant',
      entityId: variant.id,
      newValue: variant,
    });
    return created(res, variant);
  }),
);

router.put(
  '/variants/:id',
  requirePermission('product.update'),
  validate({ params: uuidParam, body: variantSchema.partial() }),
  asyncHandler(async (req, res) => {
    const existing = await prisma.productVariant.findFirst({
      where: { id: req.params.id, product: { organizationId: orgId(req) } },
    });
    if (!existing) throw notFound('NOT_FOUND', 'Variant not found.');
    const variant = await prisma.productVariant.update({
      where: { id: existing.id },
      data: req.body,
    });
    return ok(res, variant);
  }),
);

// ----------------------------------------------------------------- bundles ---

const bundleSchema = z.object({
  name: z.string().trim().min(1).max(160),
  items: z
    .array(
      z.object({ componentProductId: z.string().uuid(), quantity: positiveDecimal }),
    )
    .min(1, 'A bundle needs at least one component'),
});

router.get(
  '/:id/bundle',
  requirePermission('product.view'),
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => {
    const bundle = await prisma.productBundle.findFirst({
      where: { productId: req.params.id, organizationId: orgId(req) },
      include: {
        items: { include: { componentProduct: { select: { id: true, name: true, sku: true } } } },
      },
    });
    if (!bundle) throw notFound('NOT_FOUND', 'Bundle not configured for this product.');
    return ok(res, bundle);
  }),
);

router.put(
  '/:id/bundle',
  requirePermission('ecommerce.bundle.manage'),
  validate({ params: uuidParam, body: bundleSchema }),
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, organizationId },
      select: { id: true },
    });
    if (!product) throw notFound('PRODUCT_NOT_FOUND', 'Product not found.');
    const body = req.body as z.infer<typeof bundleSchema>;
    if (body.items.some((i) => i.componentProductId === product.id)) {
      throw badRequest('VALIDATION_ERROR', 'A bundle cannot contain itself.');
    }

    const bundle = await prisma.$transaction(async (tx) => {
      const upserted = await tx.productBundle.upsert({
        where: { organizationId_productId: { organizationId, productId: product.id } },
        create: { organizationId, productId: product.id, name: body.name },
        update: { name: body.name },
      });
      await tx.productBundleItem.deleteMany({ where: { bundleId: upserted.id } });
      await tx.productBundleItem.createMany({
        data: body.items.map((item) => ({
          bundleId: upserted.id,
          componentProductId: item.componentProductId,
          quantity: String(item.quantity),
        })),
      });
      return tx.productBundle.findUniqueOrThrow({
        where: { id: upserted.id },
        include: { items: true },
      });
    });

    await auditFromRequest(req, {
      action: 'PRODUCT_BUNDLE_SAVED',
      module: 'ecommerce',
      entityType: 'ProductBundle',
      entityId: bundle.id,
      newValue: bundle,
    });
    return ok(res, bundle);
  }),
);

export default router;
