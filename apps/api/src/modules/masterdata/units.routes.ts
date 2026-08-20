import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { ok } from '../../lib/http';
import { badRequest, notFound } from '../../lib/errors';
import { positiveDecimal, uuidParam } from '../../lib/query';
import { crudRouter, delegate } from '../../lib/crud';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../middleware/asyncHandler';
import { orgId, requirePermission } from '../../middleware/auth';
import { convertQuantity } from '../../services/unit.service';

const router = Router();

const DIMENSIONS = ['COUNT', 'WEIGHT', 'VOLUME', 'LENGTH'] as const;

/** Converts a quantity between two units of the same dimension. */
router.post(
  '/convert',
  requirePermission('product.view'),
  validate({
    body: z.object({
      quantity: positiveDecimal,
      fromUnitId: z.string().uuid(),
      toUnitId: z.string().uuid(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const units = await prisma.unit.findMany({
      where: { organizationId: orgId(req), id: { in: [req.body.fromUnitId, req.body.toUnitId] } },
    });
    const from = units.find((u) => u.id === req.body.fromUnitId);
    const to = units.find((u) => u.id === req.body.toUnitId);
    if (!from || !to) throw notFound('NOT_FOUND', 'Unit not found.');
    const converted = convertQuantity(req.body.quantity, from, to);
    return ok(res, {
      quantity: String(req.body.quantity),
      from: from.code,
      to: to.code,
      converted: converted.toFixed(4),
    });
  }),
);

router.post(
  '/:id/conversions',
  requirePermission('unit.manage'),
  validate({
    params: uuidParam,
    body: z.object({ toUnitId: z.string().uuid(), factor: positiveDecimal }),
  }),
  asyncHandler(async (req, res) => {
    const units = await prisma.unit.findMany({
      where: { organizationId: orgId(req), id: { in: [req.params.id, req.body.toUnitId] } },
    });
    if (units.length !== 2) throw notFound('NOT_FOUND', 'Unit not found.');
    if (units[0].dimension !== units[1].dimension) {
      throw badRequest('VALIDATION_ERROR', 'Units of different dimensions cannot be converted.');
    }
    const conversion = await prisma.unitConversion.upsert({
      where: { fromUnitId_toUnitId: { fromUnitId: req.params.id, toUnitId: req.body.toUnitId } },
      create: {
        fromUnitId: req.params.id,
        toUnitId: req.body.toUnitId,
        factor: String(req.body.factor),
      },
      update: { factor: String(req.body.factor) },
    });
    return ok(res, conversion);
  }),
);

router.use(
  '/',
  crudRouter({
    entity: 'Unit',
    module: 'masterdata',
    delegate: delegate(prisma.unit),
    viewPermission: 'product.view',
    managePermission: 'unit.manage',
    sortable: ['name', 'code', 'dimension'],
    defaultSort: 'code',
    searchFields: ['name', 'code'],
    filters: { dimension: z.enum(DIMENSIONS).optional() },
    createSchema: z.object({
      name: z.string().trim().min(1).max(60),
      code: z.string().trim().min(1).max(12),
      dimension: z.enum(DIMENSIONS).default('COUNT'),
      factorToBase: positiveDecimal.default(1),
      isBase: z.boolean().default(false),
      status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
    }),
  }),
);

export default router;
