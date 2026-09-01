import { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { MulterError } from 'multer';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

export function notFoundHandler(req: Request, res: Response) {
  return res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} does not exist.` },
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed.',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
  }

  if (err instanceof MulterError) {
    const tooLarge = err.code === 'LIMIT_FILE_SIZE';
    return res.status(tooLarge ? 413 : 400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: tooLarge ? 'The uploaded file is too large.' : `Upload rejected: ${err.message}.`,
      },
    });
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      // Scoping columns are implementation detail; only report the fields a user typed.
      const columns = (Array.isArray(err.meta?.target) ? (err.meta?.target as string[]) : []).filter(
        (column) => !['organizationId', 'productId'].includes(column),
      );
      const fields = columns.length ? columns : ['field'];
      return res.status(409).json({
        success: false,
        error: {
          code: fields.includes('sku') ? 'DUPLICATE_SKU' : 'CONFLICT',
          message: `A record with the same ${fields.join(', ')} already exists.`,
          details: columns.map((column) => ({
            path: column,
            message: `This ${column} is already in use.`,
          })),
        },
      });
    }
    if (err.code === 'P2025') {
      return res
        .status(404)
        .json({ success: false, error: { code: 'NOT_FOUND', message: 'Record not found.' } });
    }
    if (err.code === 'P2003') {
      return res.status(409).json({
        success: false,
        error: { code: 'CONFLICT', message: 'Record is referenced by other records.' },
      });
    }
  }

  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  return res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
  });
}
