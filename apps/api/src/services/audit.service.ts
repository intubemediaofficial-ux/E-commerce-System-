import { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

export interface AuditInput {
  organizationId?: string | null;
  userId?: string | null;
  action: string;
  module: string;
  entityType?: string;
  entityId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  ip?: string;
  userAgent?: string;
}

const asJson = (value: unknown): Prisma.InputJsonValue | undefined =>
  value === undefined || value === null ? undefined : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);

/** Audit writes never block the caller and never throw. */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: input.organizationId ?? null,
        userId: input.userId ?? null,
        action: input.action,
        module: input.module,
        entityType: input.entityType,
        entityId: input.entityId,
        oldValue: asJson(input.oldValue),
        newValue: asJson(input.newValue),
        ip: input.ip,
        userAgent: input.userAgent,
      },
    });
  } catch (err) {
    logger.warn({ err }, 'Failed to write audit log');
  }
}

export function auditFromRequest(
  req: Request,
  input: Omit<AuditInput, 'organizationId' | 'userId' | 'ip' | 'userAgent'>,
): Promise<void> {
  return recordAudit({
    ...input,
    organizationId: req.auth?.organizationId,
    userId: req.auth?.userId,
    ip: req.ip,
    userAgent: req.header('user-agent') ?? undefined,
  });
}
