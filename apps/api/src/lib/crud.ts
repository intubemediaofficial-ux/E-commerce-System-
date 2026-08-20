import { Router } from 'express';
import { ZodTypeAny, z } from 'zod';
import { created, ok, pageMeta } from './http';
import { notFound } from './errors';
import { orderBy, paginationSchema, skipTake, uuidParam } from './query';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../middleware/asyncHandler';
import { orgId, requirePermission } from '../middleware/auth';
import { auditFromRequest } from '../services/audit.service';
import type { Permission } from '../auth/permissions';

/**
 * Minimal surface of a Prisma model delegate. Concrete delegates are passed in
 * through `delegate()` which keeps the factory reusable across models.
 */
export interface CrudDelegate {
  findMany(args: Record<string, unknown>): Promise<unknown[]>;
  count(args: Record<string, unknown>): Promise<number>;
  findFirst(args: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  create(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  update(args: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface CrudOptions {
  /** Entity label used in audit records and error messages, e.g. `Brand`. */
  entity: string;
  module: string;
  delegate: CrudDelegate;
  viewPermission: Permission;
  managePermission: Permission;
  createSchema: ZodTypeAny;
  updateSchema?: ZodTypeAny;
  /** Columns that may be used for sorting. */
  sortable: readonly string[];
  defaultSort: string;
  /** Columns matched (case-insensitively) by the `search` query parameter. */
  searchFields?: readonly string[];
  /** Extra query parameters mapped into the Prisma `where` clause. */
  filters?: Record<string, ZodTypeAny>;
  include?: Record<string, unknown>;
  /** Soft delete: entities are archived so historical documents keep resolving. */
  archiveOnDelete?: boolean;
}

export function crudRouter(options: CrudOptions): Router {
  const router = Router();
  const filterSchema = z.object(options.filters ?? {});
  const querySchema = paginationSchema.merge(filterSchema);

  router.get(
    '/',
    requirePermission(options.viewPermission),
    validate({ query: querySchema }),
    asyncHandler(async (req, res) => {
      const q = req.query as unknown as z.infer<typeof paginationSchema> & Record<string, unknown>;
      const filters: Record<string, unknown> = {};
      for (const key of Object.keys(options.filters ?? {})) {
        if (q[key] !== undefined) filters[key] = q[key];
      }
      const search = q.search;
      const where = {
        organizationId: orgId(req),
        ...filters,
        ...(search && options.searchFields?.length
          ? {
              OR: options.searchFields.map((field) => ({
                [field]: { contains: search, mode: 'insensitive' },
              })),
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        options.delegate.findMany({
          where,
          ...skipTake(q),
          orderBy: orderBy(q, options.sortable, options.defaultSort),
          ...(options.include ? { include: options.include } : {}),
        }),
        options.delegate.count({ where }),
      ]);
      return ok(res, rows, pageMeta(q.page, q.perPage, total));
    }),
  );

  router.get(
    '/:id',
    requirePermission(options.viewPermission),
    validate({ params: uuidParam }),
    asyncHandler(async (req, res) => {
      const row = await options.delegate.findFirst({
        where: { id: req.params.id, organizationId: orgId(req) },
        ...(options.include ? { include: options.include } : {}),
      });
      if (!row) throw notFound('NOT_FOUND', `${options.entity} not found.`);
      return ok(res, row);
    }),
  );

  router.post(
    '/',
    requirePermission(options.managePermission),
    validate({ body: options.createSchema }),
    asyncHandler(async (req, res) => {
      const row = await options.delegate.create({
        data: { ...req.body, organizationId: orgId(req) },
      });
      await auditFromRequest(req, {
        action: `${options.entity.toUpperCase()}_CREATED`,
        module: options.module,
        entityType: options.entity,
        entityId: String(row.id),
        newValue: row,
      });
      return created(res, row);
    }),
  );

  router.put(
    '/:id',
    requirePermission(options.managePermission),
    validate({ params: uuidParam, body: options.updateSchema ?? options.createSchema }),
    asyncHandler(async (req, res) => {
      const existing = await options.delegate.findFirst({
        where: { id: req.params.id, organizationId: orgId(req) },
      });
      if (!existing) throw notFound('NOT_FOUND', `${options.entity} not found.`);
      const row = await options.delegate.update({ where: { id: existing.id }, data: req.body });
      await auditFromRequest(req, {
        action: `${options.entity.toUpperCase()}_UPDATED`,
        module: options.module,
        entityType: options.entity,
        entityId: String(row.id),
        oldValue: existing,
        newValue: row,
      });
      return ok(res, row);
    }),
  );

  router.delete(
    '/:id',
    requirePermission(options.managePermission),
    validate({ params: uuidParam }),
    asyncHandler(async (req, res) => {
      const existing = await options.delegate.findFirst({
        where: { id: req.params.id, organizationId: orgId(req) },
      });
      if (!existing) throw notFound('NOT_FOUND', `${options.entity} not found.`);
      const row = await options.delegate.update({
        where: { id: existing.id },
        data: { status: 'ARCHIVED' },
      });
      await auditFromRequest(req, {
        action: `${options.entity.toUpperCase()}_ARCHIVED`,
        module: options.module,
        entityType: options.entity,
        entityId: String(row.id),
        oldValue: existing,
        newValue: row,
      });
      return ok(res, row);
    }),
  );

  return router;
}

/** Adapts a Prisma delegate to the {@link CrudDelegate} surface. */
export const delegate = (model: unknown): CrudDelegate => model as CrudDelegate;
