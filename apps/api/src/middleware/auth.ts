import { NextFunction, Request, Response } from 'express';
import { forbidden, unauthorized } from '../lib/errors';
import { verifyAccessToken } from '../auth/tokens';
import type { Permission } from '../auth/permissions';

export interface AuthContext {
  userId: string;
  organizationId: string;
  email: string;
  roles: string[];
  permissions: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(unauthorized());
  }
  const payload = verifyAccessToken(header.slice(7).trim());
  req.auth = {
    userId: payload.sub,
    organizationId: payload.organizationId,
    email: payload.email,
    roles: payload.roles ?? [],
    permissions: payload.permissions ?? [],
  };
  return next();
}

/** Requires the caller to hold every listed permission. */
export function requirePermission(...required: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const auth = req.auth;
    if (!auth) return next(unauthorized());
    if (auth.roles.includes('super_admin') || auth.roles.includes('admin')) return next();
    const missing = required.filter((p) => !auth.permissions.includes(p));
    if (missing.length > 0) {
      return next(forbidden(`Missing permission(s): ${missing.join(', ')}.`));
    }
    return next();
  };
}

/** Requires any one of the listed permissions. */
export function requireAnyPermission(...required: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const auth = req.auth;
    if (!auth) return next(unauthorized());
    if (auth.roles.includes('super_admin') || auth.roles.includes('admin')) return next();
    if (required.some((p) => auth.permissions.includes(p))) return next();
    return next(forbidden(`Missing permission(s): one of ${required.join(', ')}.`));
  };
}

export function orgId(req: Request): string {
  if (!req.auth) throw unauthorized();
  return req.auth.organizationId;
}

export function userId(req: Request): string {
  if (!req.auth) throw unauthorized();
  return req.auth.userId;
}
