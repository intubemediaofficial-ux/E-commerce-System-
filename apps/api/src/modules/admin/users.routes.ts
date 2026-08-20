import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { created, ok, pageMeta } from '../../lib/http';
import { badRequest, notFound } from '../../lib/errors';
import { paginationSchema, skipTake, uuidParam } from '../../lib/query';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../middleware/asyncHandler';
import { orgId, requirePermission, userId } from '../../middleware/auth';
import { auditFromRequest } from '../../services/audit.service';
import { hashPassword, revokeAllRefreshTokens } from '../../auth/tokens';

const router = Router();

const userSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  status: true,
  emailVerifiedAt: true,
  lastLoginAt: true,
  createdAt: true,
  userRoles: { include: { role: { select: { id: true, slug: true, name: true } } } },
} satisfies Prisma.UserSelect;

const createSchema = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.string().email().transform((v) => v.toLowerCase()),
  phone: z.string().trim().max(30).optional(),
  password: z.string().min(10).max(128),
  roleIds: z.array(z.string().uuid()).min(1, 'Assign at least one role'),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
});

router.get(
  '/',
  requirePermission('user.manage'),
  validate({ query: paginationSchema.extend({ status: z.string().optional() }) }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof paginationSchema> & { status?: string };
    const where: Prisma.UserWhereInput = {
      organizationId: orgId(req),
      ...(q.status ? { status: q.status as Prisma.EnumStatusFilter['equals'] } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { email: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.user.findMany({ where, ...skipTake(q), orderBy: { name: q.sortDir }, select: userSelect }),
      prisma.user.count({ where }),
    ]);
    return ok(res, rows, pageMeta(q.page, q.perPage, total));
  }),
);

router.get(
  '/:id',
  requirePermission('user.manage'),
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
      select: userSelect,
    });
    if (!user) throw notFound('NOT_FOUND', 'User not found.');
    return ok(res, user);
  }),
);

router.post(
  '/',
  requirePermission('user.manage'),
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const body = req.body as z.infer<typeof createSchema>;

    const roles = await prisma.role.findMany({
      where: { id: { in: body.roleIds }, OR: [{ organizationId }, { organizationId: null }] },
      select: { id: true },
    });
    if (roles.length !== body.roleIds.length) {
      throw badRequest('VALIDATION_ERROR', 'One or more roles are not available in this organization.');
    }

    const user = await prisma.user.create({
      data: {
        organizationId,
        name: body.name,
        email: body.email,
        phone: body.phone,
        passwordHash: await hashPassword(body.password),
        status: body.status ?? 'ACTIVE',
        userRoles: { create: roles.map((role) => ({ roleId: role.id })) },
      },
      select: userSelect,
    });

    await auditFromRequest(req, {
      action: 'USER_CREATED',
      module: 'admin',
      entityType: 'User',
      entityId: user.id,
      newValue: { email: user.email, roles: body.roleIds },
    });
    return created(res, user);
  }),
);

router.put(
  '/:id',
  requirePermission('user.manage'),
  validate({
    params: uuidParam,
    body: createSchema.partial().omit({ password: true }),
  }),
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const existing = await prisma.user.findFirst({
      where: { id: req.params.id, organizationId },
      select: userSelect,
    });
    if (!existing) throw notFound('NOT_FOUND', 'User not found.');
    const body = req.body as Partial<z.infer<typeof createSchema>>;

    const user = await prisma.$transaction(async (tx) => {
      if (body.roleIds) {
        await tx.userRole.deleteMany({ where: { userId: existing.id } });
        await tx.userRole.createMany({
          data: body.roleIds.map((roleId) => ({ userId: existing.id, roleId })),
        });
      }
      return tx.user.update({
        where: { id: existing.id },
        data: {
          name: body.name,
          email: body.email,
          phone: body.phone,
          status: body.status,
        },
        select: userSelect,
      });
    });

    if (body.status && body.status !== 'ACTIVE') {
      await revokeAllRefreshTokens(existing.id);
    }

    await auditFromRequest(req, {
      action: 'USER_UPDATED',
      module: 'admin',
      entityType: 'User',
      entityId: user.id,
      oldValue: existing,
      newValue: user,
    });
    return ok(res, user);
  }),
);

router.post(
  '/:id/password',
  requirePermission('user.manage'),
  validate({ params: uuidParam, body: z.object({ password: z.string().min(10).max(128) }) }),
  asyncHandler(async (req, res) => {
    const existing = await prisma.user.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
      select: { id: true },
    });
    if (!existing) throw notFound('NOT_FOUND', 'User not found.');
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash: await hashPassword(req.body.password) },
    });
    await revokeAllRefreshTokens(existing.id);
    await auditFromRequest(req, {
      action: 'USER_PASSWORD_RESET',
      module: 'admin',
      entityType: 'User',
      entityId: existing.id,
    });
    return ok(res, { id: existing.id });
  }),
);

router.delete(
  '/:id',
  requirePermission('user.manage'),
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    if (req.params.id === userId(req)) {
      throw badRequest('VALIDATION_ERROR', 'You cannot archive your own account.');
    }
    const existing = await prisma.user.findFirst({
      where: { id: req.params.id, organizationId },
      select: { id: true },
    });
    if (!existing) throw notFound('NOT_FOUND', 'User not found.');
    const user = await prisma.user.update({
      where: { id: existing.id },
      data: { status: 'ARCHIVED' },
      select: userSelect,
    });
    await revokeAllRefreshTokens(existing.id);
    await auditFromRequest(req, {
      action: 'USER_ARCHIVED',
      module: 'admin',
      entityType: 'User',
      entityId: user.id,
      newValue: { status: user.status },
    });
    return ok(res, user);
  }),
);

export default router;
