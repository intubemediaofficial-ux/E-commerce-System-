import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { created, ok, pageMeta } from '../../lib/http';
import { notFound } from '../../lib/errors';
import { orderBy, paginationSchema, skipTake, uuidParam } from '../../lib/query';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../middleware/asyncHandler';
import { orgId, requirePermission } from '../../middleware/auth';
import { auditFromRequest } from '../../services/audit.service';

const router = Router();

const bodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  parentCategoryId: z.string().uuid().nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
});

const SORTABLE = ['name', 'createdAt', 'updatedAt'] as const;

router.get(
  '/',
  requirePermission('product.view'),
  validate({ query: paginationSchema.extend({ parentCategoryId: z.string().uuid().optional() }) }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof paginationSchema> & { parentCategoryId?: string };
    const where = {
      organizationId: orgId(req),
      ...(q.search ? { name: { contains: q.search, mode: 'insensitive' as const } } : {}),
      ...(q.parentCategoryId ? { parentCategoryId: q.parentCategoryId } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.category.findMany({
        where,
        ...skipTake(q),
        orderBy: orderBy(q, SORTABLE, 'name'),
        include: { parent: { select: { id: true, name: true } }, _count: { select: { products: true } } },
      }),
      prisma.category.count({ where }),
    ]);
    return ok(res, rows, pageMeta(q.page, q.perPage, total));
  }),
);

router.get(
  '/tree',
  requirePermission('product.view'),
  asyncHandler(async (req, res) => {
    const rows = await prisma.category.findMany({
      where: { organizationId: orgId(req), status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, parentCategoryId: true },
    });
    type Node = { id: string; name: string; children: Node[] };
    const nodes = new Map<string, Node>(rows.map((r) => [r.id, { id: r.id, name: r.name, children: [] }]));
    const roots: Node[] = [];
    for (const row of rows) {
      const node = nodes.get(row.id)!;
      const parent = row.parentCategoryId ? nodes.get(row.parentCategoryId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return ok(res, roots);
  }),
);

router.post(
  '/',
  requirePermission('category.manage'),
  validate({ body: bodySchema }),
  asyncHandler(async (req, res) => {
    const category = await prisma.category.create({
      data: { ...req.body, organizationId: orgId(req) },
    });
    await auditFromRequest(req, {
      action: 'CATEGORY_CREATED',
      module: 'masterdata',
      entityType: 'Category',
      entityId: category.id,
      newValue: category,
    });
    return created(res, category);
  }),
);

router.put(
  '/:id',
  requirePermission('category.manage'),
  validate({ params: uuidParam, body: bodySchema.partial() }),
  asyncHandler(async (req, res) => {
    const existing = await prisma.category.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
    });
    if (!existing) throw notFound('NOT_FOUND', 'Category not found.');
    const category = await prisma.category.update({ where: { id: existing.id }, data: req.body });
    await auditFromRequest(req, {
      action: 'CATEGORY_UPDATED',
      module: 'masterdata',
      entityType: 'Category',
      entityId: category.id,
      oldValue: existing,
      newValue: category,
    });
    return ok(res, category);
  }),
);

router.delete(
  '/:id',
  requirePermission('category.manage'),
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => {
    const existing = await prisma.category.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
    });
    if (!existing) throw notFound('NOT_FOUND', 'Category not found.');
    // Categories are archived rather than deleted so historical data stays intact.
    const category = await prisma.category.update({
      where: { id: existing.id },
      data: { status: 'ARCHIVED' },
    });
    await auditFromRequest(req, {
      action: 'CATEGORY_ARCHIVED',
      module: 'masterdata',
      entityType: 'Category',
      entityId: category.id,
      oldValue: existing,
      newValue: category,
    });
    return ok(res, category);
  }),
);

export default router;
