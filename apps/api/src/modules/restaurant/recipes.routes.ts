import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, transaction } from '../../lib/prisma';
import { created, ok, pageMeta } from '../../lib/http';
import { badRequest, notFound } from '../../lib/errors';
import { nonNegativeDecimal, paginationSchema, positiveDecimal, skipTake, uuidParam } from '../../lib/query';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../middleware/asyncHandler';
import { orgId, requirePermission } from '../../middleware/auth';
import { auditFromRequest } from '../../services/audit.service';
import { recipeCost } from '../../services/recipe.service';

const router = Router();

const itemSchema = z.object({
  ingredientProductId: z.string().uuid(),
  quantity: positiveDecimal,
  unitId: z.string().uuid().nullable().optional(),
  wastagePercentage: nonNegativeDecimal.default(0),
});

const createSchema = z.object({
  productId: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  yieldQuantity: positiveDecimal.default(1),
  unitLabel: z.string().trim().max(40).nullable().optional(),
  instructions: z.string().trim().max(5000).nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
  items: z.array(itemSchema).min(1, 'A recipe needs at least one ingredient'),
});

router.get(
  '/',
  requirePermission('recipe.view'),
  validate({ query: paginationSchema.extend({ productId: z.string().uuid().optional() }) }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof paginationSchema> & { productId?: string };
    const where: Prisma.RecipeWhereInput = {
      organizationId: orgId(req),
      ...(q.productId ? { productId: q.productId } : {}),
      ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.recipe.findMany({
        where,
        ...skipTake(q),
        orderBy: { name: q.sortDir },
        include: {
          product: { select: { id: true, name: true, sku: true } },
          items: {
            include: { ingredientProduct: { select: { id: true, name: true, sku: true } } },
          },
        },
      }),
      prisma.recipe.count({ where }),
    ]);
    return ok(res, rows, pageMeta(q.page, q.perPage, total));
  }),
);

router.get(
  '/:id/cost',
  requirePermission('recipe.view'),
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const cost = await transaction((tx) => recipeCost(tx, organizationId, req.params.id));
    return ok(res, {
      totalCost: cost.totalCost.toFixed(4),
      costPerUnit: cost.costPerUnit.toFixed(4),
      items: cost.items.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity.toFixed(4),
        cost: item.cost.toFixed(4),
      })),
    });
  }),
);

router.get(
  '/:id',
  requirePermission('recipe.view'),
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => {
    const recipe = await prisma.recipe.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
      include: {
        product: { select: { id: true, name: true, sku: true, sellingPrice: true } },
        items: {
          include: {
            ingredientProduct: { select: { id: true, name: true, sku: true } },
            unit: { select: { id: true, code: true } },
          },
        },
      },
    });
    if (!recipe) throw notFound('NOT_FOUND', 'Recipe not found.');
    return ok(res, recipe);
  }),
);

function assertNoSelfReference(productId: string, items: z.infer<typeof itemSchema>[]): void {
  if (items.some((item) => item.ingredientProductId === productId)) {
    throw badRequest('VALIDATION_ERROR', 'A recipe product cannot be its own ingredient.');
  }
}

router.post(
  '/',
  requirePermission('recipe.manage'),
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const body = req.body as z.infer<typeof createSchema>;
    assertNoSelfReference(body.productId, body.items);

    const productIds = [...new Set([body.productId, ...body.items.map((i) => i.ingredientProductId)])];
    const known = await prisma.product.count({
      where: { organizationId, id: { in: productIds } },
    });
    if (known !== productIds.length) {
      throw badRequest('PRODUCT_NOT_FOUND', 'One or more recipe products do not exist.');
    }

    const recipe = await prisma.recipe.create({
      data: {
        organizationId,
        productId: body.productId,
        name: body.name,
        yieldQuantity: String(body.yieldQuantity),
        unitLabel: body.unitLabel ?? null,
        instructions: body.instructions ?? null,
        status: body.status,
        items: {
          create: body.items.map((item) => ({
            ingredientProductId: item.ingredientProductId,
            quantity: String(item.quantity),
            unitId: item.unitId ?? null,
            wastagePercentage: String(item.wastagePercentage),
          })),
        },
      },
      include: { items: true },
    });

    await auditFromRequest(req, {
      action: 'RECIPE_CREATED',
      module: 'restaurant',
      entityType: 'Recipe',
      entityId: recipe.id,
      newValue: recipe,
    });
    return created(res, recipe);
  }),
);

router.put(
  '/:id',
  requirePermission('recipe.manage'),
  validate({ params: uuidParam, body: createSchema.partial({ productId: true, items: true }) }),
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const existing = await prisma.recipe.findFirst({
      where: { id: req.params.id, organizationId },
      include: { items: true },
    });
    if (!existing) throw notFound('NOT_FOUND', 'Recipe not found.');
    const body = req.body as Partial<z.infer<typeof createSchema>>;
    if (body.items) assertNoSelfReference(existing.productId, body.items);

    const recipe = await transaction(async (tx) => {
      if (body.items) {
        await tx.recipeItem.deleteMany({ where: { recipeId: existing.id } });
        await tx.recipeItem.createMany({
          data: body.items.map((item) => ({
            recipeId: existing.id,
            ingredientProductId: item.ingredientProductId,
            quantity: String(item.quantity),
            unitId: item.unitId ?? null,
            wastagePercentage: String(item.wastagePercentage),
          })),
        });
      }
      return tx.recipe.update({
        where: { id: existing.id },
        data: {
          name: body.name ?? existing.name,
          yieldQuantity:
            body.yieldQuantity === undefined ? existing.yieldQuantity : String(body.yieldQuantity),
          unitLabel: body.unitLabel === undefined ? existing.unitLabel : body.unitLabel,
          instructions: body.instructions === undefined ? existing.instructions : body.instructions,
          status: body.status ?? existing.status,
        },
        include: { items: true },
      });
    });

    await auditFromRequest(req, {
      action: 'RECIPE_UPDATED',
      module: 'restaurant',
      entityType: 'Recipe',
      entityId: recipe.id,
      oldValue: existing,
      newValue: recipe,
    });
    return ok(res, recipe);
  }),
);

router.delete(
  '/:id',
  requirePermission('recipe.manage'),
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => {
    const existing = await prisma.recipe.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
    });
    if (!existing) throw notFound('NOT_FOUND', 'Recipe not found.');
    const recipe = await prisma.recipe.update({
      where: { id: existing.id },
      data: { status: 'ARCHIVED' },
    });
    await auditFromRequest(req, {
      action: 'RECIPE_ARCHIVED',
      module: 'restaurant',
      entityType: 'Recipe',
      entityId: recipe.id,
      oldValue: existing,
      newValue: recipe,
    });
    return ok(res, recipe);
  }),
);

export default router;
