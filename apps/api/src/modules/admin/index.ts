import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { created, ok, pageMeta } from '../../lib/http';
import { badRequest, notFound } from '../../lib/errors';
import { nonNegativeDecimal, paginationSchema, skipTake, uuidParam } from '../../lib/query';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../middleware/asyncHandler';
import { orgId, requirePermission, userId } from '../../middleware/auth';
import { auditFromRequest } from '../../services/audit.service';
import { ALL_PERMISSIONS, PERMISSIONS, Permission } from '../../auth/permissions';
import usersRouter from './users.routes';

export const adminRouter = Router();

adminRouter.use('/users', usersRouter);

// ------------------------------------------------------------------- roles ---

const roleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9_]+$/, 'Use lowercase letters, digits and underscores'),
  description: z.string().trim().max(500).optional(),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]])).min(1),
});

adminRouter.get(
  '/permissions',
  requirePermission('role.manage'),
  asyncHandler(async (_req, res) => {
    const rows = await prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { slug: 'asc' }] });
    return ok(res, {
      catalog: PERMISSIONS,
      permissions: rows,
    });
  }),
);

adminRouter.get(
  '/roles',
  requirePermission('role.manage'),
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const roles = await prisma.role.findMany({
      where: { OR: [{ organizationId }, { organizationId: null }] },
      orderBy: { name: 'asc' },
      include: {
        rolePermissions: { include: { permission: { select: { slug: true, module: true } } } },
        _count: { select: { userRoles: true } },
      },
    });
    return ok(
      res,
      roles.map((role) => ({
        id: role.id,
        name: role.name,
        slug: role.slug,
        description: role.description,
        isSystem: role.isSystem,
        userCount: role._count.userRoles,
        permissions: role.rolePermissions.map((rp) => rp.permission.slug),
      })),
    );
  }),
);

adminRouter.post(
  '/roles',
  requirePermission('role.manage'),
  validate({ body: roleSchema }),
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const body = req.body as z.infer<typeof roleSchema>;
    const permissions = await prisma.permission.findMany({
      where: { slug: { in: body.permissions } },
      select: { id: true },
    });
    const role = await prisma.role.create({
      data: {
        organizationId,
        name: body.name,
        slug: body.slug,
        description: body.description,
        rolePermissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
      },
      include: { rolePermissions: true },
    });
    await auditFromRequest(req, {
      action: 'ROLE_CREATED',
      module: 'admin',
      entityType: 'Role',
      entityId: role.id,
      newValue: { slug: role.slug, permissions: body.permissions },
    });
    return created(res, role);
  }),
);

adminRouter.put(
  '/roles/:id',
  requirePermission('role.manage'),
  validate({ params: uuidParam, body: roleSchema.partial() }),
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const existing = await prisma.role.findFirst({
      where: { id: req.params.id, organizationId },
      include: { rolePermissions: { include: { permission: true } } },
    });
    if (!existing) {
      throw notFound('NOT_FOUND', 'Role not found in this organization (system roles are read-only).');
    }
    const body = req.body as Partial<z.infer<typeof roleSchema>>;

    const role = await prisma.$transaction(async (tx) => {
      if (body.permissions) {
        const permissions = await tx.permission.findMany({
          where: { slug: { in: body.permissions } },
          select: { id: true },
        });
        await tx.rolePermission.deleteMany({ where: { roleId: existing.id } });
        await tx.rolePermission.createMany({
          data: permissions.map((p) => ({ roleId: existing.id, permissionId: p.id })),
        });
      }
      return tx.role.update({
        where: { id: existing.id },
        data: { name: body.name, description: body.description },
        include: { rolePermissions: { include: { permission: { select: { slug: true } } } } },
      });
    });

    await auditFromRequest(req, {
      action: 'ROLE_UPDATED',
      module: 'admin',
      entityType: 'Role',
      entityId: role.id,
      oldValue: { permissions: existing.rolePermissions.map((rp) => rp.permission.slug) },
      newValue: { permissions: role.rolePermissions.map((rp) => rp.permission.slug) },
    });
    return ok(res, role);
  }),
);

adminRouter.delete(
  '/roles/:id',
  requirePermission('role.manage'),
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => {
    const existing = await prisma.role.findFirst({
      where: { id: req.params.id, organizationId: orgId(req), isSystem: false },
      include: { _count: { select: { userRoles: true } } },
    });
    if (!existing) throw notFound('NOT_FOUND', 'Custom role not found.');
    if (existing._count.userRoles > 0) {
      throw badRequest('VALIDATION_ERROR', 'Reassign users before deleting this role.');
    }
    await prisma.role.delete({ where: { id: existing.id } });
    await auditFromRequest(req, {
      action: 'ROLE_DELETED',
      module: 'admin',
      entityType: 'Role',
      entityId: existing.id,
    });
    return ok(res, { id: existing.id });
  }),
);

// ---------------------------------------------------------- organization ---

adminRouter.get(
  '/organization',
  requirePermission('organization.manage'),
  asyncHandler(async (req, res) => {
    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: orgId(req) },
      include: { settings: true, _count: { select: { users: true, warehouses: true, products: true } } },
    });
    return ok(res, organization);
  }),
);

adminRouter.put(
  '/organization',
  requirePermission('organization.manage'),
  validate({
    body: z.object({
      name: z.string().trim().min(1).max(160).optional(),
      email: z.string().email().nullable().optional(),
      phone: z.string().trim().max(30).nullable().optional(),
      address: z.string().trim().max(500).nullable().optional(),
      taxNumber: z.string().trim().max(60).nullable().optional(),
      currency: z.string().trim().length(3).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const organization = await prisma.organization.update({
      where: { id: orgId(req) },
      data: req.body,
    });
    await auditFromRequest(req, {
      action: 'ORGANIZATION_UPDATED',
      module: 'admin',
      entityType: 'Organization',
      entityId: organization.id,
      newValue: organization,
    });
    return ok(res, organization);
  }),
);

const settingsSchema = z.object({
  allowNegativeStock: z.boolean().optional(),
  valuationMethod: z.enum(['FIFO', 'WEIGHTED_AVERAGE']).optional(),
  useFefoForPerishables: z.boolean().optional(),
  allowExpiredConsumption: z.boolean().optional(),
  reservationTtlMinutes: z.coerce.number().int().min(5).max(10_080).optional(),
  adjustmentApprovalValue: nonNegativeDecimal.optional(),
  notifyByEmail: z.boolean().optional(),
  notifyInApp: z.boolean().optional(),
});

adminRouter.get(
  '/settings',
  requirePermission('settings.manage'),
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const settings = await prisma.organizationSettings.upsert({
      where: { organizationId },
      create: { organizationId },
      update: {},
    });
    return ok(res, settings);
  }),
);

adminRouter.put(
  '/settings',
  requirePermission('settings.manage'),
  validate({ body: settingsSchema }),
  asyncHandler(async (req, res) => {
    const organizationId = orgId(req);
    const body = req.body as z.infer<typeof settingsSchema>;
    const data = {
      ...body,
      ...(body.adjustmentApprovalValue === undefined
        ? {}
        : { adjustmentApprovalValue: String(body.adjustmentApprovalValue) }),
    };
    const previous = await prisma.organizationSettings.findUnique({ where: { organizationId } });
    const settings = await prisma.organizationSettings.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    });
    await auditFromRequest(req, {
      action: 'SETTINGS_UPDATED',
      module: 'admin',
      entityType: 'OrganizationSettings',
      entityId: settings.id,
      oldValue: previous,
      newValue: settings,
    });
    return ok(res, settings);
  }),
);

// -------------------------------------------------------------- audit log ---

adminRouter.get(
  '/audit-logs',
  requirePermission('audit.view'),
  validate({
    query: paginationSchema.extend({
      action: z.string().optional(),
      module: z.string().optional(),
      entityType: z.string().optional(),
      entityId: z.string().optional(),
      userId: z.string().uuid().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof paginationSchema> & {
      action?: string;
      module?: string;
      entityType?: string;
      entityId?: string;
      userId?: string;
    };
    const where: Prisma.AuditLogWhereInput = {
      organizationId: orgId(req),
      ...(q.action ? { action: q.action } : {}),
      ...(q.module ? { module: q.module } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.from || q.to ? { createdAt: { gte: q.from, lte: q.to } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        ...skipTake(q),
        orderBy: { createdAt: q.sortDir },
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);
    return ok(res, rows, pageMeta(q.page, q.perPage, total));
  }),
);

// ---------------------------------------------------------- notifications ---

export const notificationsRouter = Router();

notificationsRouter.get(
  '/',
  requirePermission('notification.view'),
  validate({ query: paginationSchema.extend({ unreadOnly: z.coerce.boolean().optional() }) }),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof paginationSchema> & { unreadOnly?: boolean };
    const where: Prisma.NotificationWhereInput = {
      organizationId: orgId(req),
      OR: [{ userId: userId(req) }, { userId: null }],
      ...(q.unreadOnly ? { readAt: null } : {}),
    };
    const [rows, total, unread] = await Promise.all([
      prisma.notification.findMany({
        where,
        ...skipTake(q),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({
        where: {
          organizationId: orgId(req),
          OR: [{ userId: userId(req) }, { userId: null }],
          readAt: null,
        },
      }),
    ]);
    return ok(res, { notifications: rows, unreadCount: unread }, pageMeta(q.page, q.perPage, total));
  }),
);

notificationsRouter.post(
  '/:id/read',
  requirePermission('notification.view'),
  validate({ params: uuidParam }),
  asyncHandler(async (req, res) => {
    const notification = await prisma.notification.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
    });
    if (!notification) throw notFound('NOT_FOUND', 'Notification not found.');
    const updated = await prisma.notification.update({
      where: { id: notification.id },
      data: { readAt: new Date() },
    });
    return ok(res, updated);
  }),
);

notificationsRouter.post(
  '/read-all',
  requirePermission('notification.view'),
  asyncHandler(async (req, res) => {
    const result = await prisma.notification.updateMany({
      where: {
        organizationId: orgId(req),
        OR: [{ userId: userId(req) }, { userId: null }],
        readAt: null,
      },
      data: { readAt: new Date() },
    });
    return ok(res, { updated: result.count });
  }),
);

export default adminRouter;
