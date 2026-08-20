import crypto from 'crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { ok } from '../../lib/http';
import { badRequest, unauthorized } from '../../lib/errors';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../middleware/asyncHandler';
import { authenticate } from '../../middleware/auth';
import {
  hashPassword,
  issueRefreshToken,
  revokeAllRefreshTokens,
  revokeRefreshToken,
  rotateRefreshToken,
  sha256,
  verifyPassword,
} from '../../auth/tokens';
import { recordAudit } from '../../services/audit.service';
import { sendMail } from '../../services/mail.service';
import { authenticateWithPassword, issueAccessToken, loadUserContext } from './auth.service';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' } },
});

const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a digit');

router.post(
  '/login',
  authLimiter,
  validate({ body: z.object({ email: z.string().email(), password: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    const user = await authenticateWithPassword(req.body.email, req.body.password);
    const refreshToken = await issueRefreshToken(user.id, {
      userAgent: req.header('user-agent') ?? undefined,
      ip: req.ip,
    });
    await recordAudit({
      organizationId: user.organizationId,
      userId: user.id,
      action: 'LOGIN',
      module: 'auth',
      ip: req.ip,
      userAgent: req.header('user-agent') ?? undefined,
    });
    return ok(res, { accessToken: issueAccessToken(user), refreshToken, user });
  }),
);

router.post(
  '/refresh',
  authLimiter,
  validate({ body: z.object({ refreshToken: z.string().min(10) }) }),
  asyncHandler(async (req, res) => {
    const { userId, token } = await rotateRefreshToken(req.body.refreshToken);
    const user = await loadUserContext(userId);
    return ok(res, { accessToken: issueAccessToken(user), refreshToken: token, user });
  }),
);

router.post(
  '/logout',
  validate({ body: z.object({ refreshToken: z.string().min(10).optional() }) }),
  asyncHandler(async (req, res) => {
    if (req.body.refreshToken) await revokeRefreshToken(req.body.refreshToken);
    return ok(res, { loggedOut: true });
  }),
);

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => ok(res, await loadUserContext(req.auth!.userId))),
);

router.post(
  '/forgot-password',
  authLimiter,
  validate({ body: z.object({ email: z.string().email() }) }),
  asyncHandler(async (req, res) => {
    const email = req.body.email.toLowerCase();
    const user = await prisma.user.findFirst({ where: { email }, select: { id: true, name: true } });
    if (user) {
      const raw = crypto.randomBytes(32).toString('hex');
      await prisma.passwordResetToken.create({
        data: { email, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 3_600_000) },
      });
      await sendMail({
        to: email,
        subject: 'Reset your password',
        text: `Hello ${user.name},\n\nUse this token to reset your password within the next hour:\n\n${raw}\n`,
      });
    }
    // Always the same response so accounts cannot be enumerated.
    return ok(res, { requested: true });
  }),
);

router.post(
  '/reset-password',
  authLimiter,
  validate({ body: z.object({ token: z.string().min(10), password: passwordSchema }) }),
  asyncHandler(async (req, res) => {
    const record = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(req.body.token) },
    });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw badRequest('VALIDATION_ERROR', 'Reset token is invalid or has expired.');
    }
    const user = await prisma.user.findFirst({ where: { email: record.email } });
    if (!user) throw badRequest('VALIDATION_ERROR', 'Reset token is invalid or has expired.');

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(req.body.password) },
      }),
      prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ]);
    await revokeAllRefreshTokens(user.id);
    await recordAudit({
      organizationId: user.organizationId,
      userId: user.id,
      action: 'PASSWORD_RESET',
      module: 'auth',
      ip: req.ip,
    });
    return ok(res, { reset: true });
  }),
);

router.post(
  '/change-password',
  authenticate,
  validate({
    body: z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }),
  }),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: { id: true, passwordHash: true, organizationId: true },
    });
    if (!user) throw unauthorized();
    const valid = await verifyPassword(user.passwordHash, req.body.currentPassword);
    if (!valid) throw badRequest('VALIDATION_ERROR', 'Current password is incorrect.');

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(req.body.newPassword) },
    });
    await revokeAllRefreshTokens(user.id);
    await recordAudit({
      organizationId: user.organizationId,
      userId: user.id,
      action: 'PASSWORD_CHANGED',
      module: 'auth',
      ip: req.ip,
    });
    return ok(res, { changed: true });
  }),
);

export default router;
