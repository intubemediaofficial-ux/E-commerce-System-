import { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { conflict } from '../lib/errors';

/**
 * Replays the stored response when the same `Idempotency-Key` is used again on
 * the same endpoint, so stock changing calls can never be applied twice.
 */
export function idempotency(req: Request, res: Response, next: NextFunction) {
  const key = req.header('Idempotency-Key');
  const organizationId = req.auth?.organizationId;
  if (!key || !organizationId) return next();

  const endpoint = `${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`;

  prisma.idempotencyRecord
    .findUnique({ where: { organizationId_key_endpoint: { organizationId, key, endpoint } } })
    .then((existing) => {
      if (existing) {
        res.setHeader('Idempotent-Replay', 'true');
        res.status(existing.statusCode).json(existing.responseBody);
        return;
      }

      const originalJson = res.json.bind(res);
      res.json = (body: unknown) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          prisma.idempotencyRecord
            .create({
              data: {
                organizationId,
                key,
                endpoint,
                statusCode: res.statusCode,
                responseBody: body as Prisma.InputJsonValue,
              },
            })
            .catch(() => undefined);
        }
        return originalJson(body);
      };
      next();
    })
    .catch(() => next(conflict('CONFLICT', 'Unable to validate idempotency key.')));
}
