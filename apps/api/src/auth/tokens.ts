import crypto from 'crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import argon2 from 'argon2';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { unauthorized } from '../lib/errors';

export interface AccessTokenPayload {
  sub: string;
  organizationId: string;
  email: string;
  roles: string[];
  permissions: string[];
}

export const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id });

export const verifyPassword = (hash: string, password: string) =>
  argon2.verify(hash, password).catch(() => false);

export const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL,
  } as SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, env.JWT_SECRET) as AccessTokenPayload;
  } catch {
    throw unauthorized('Invalid or expired access token.');
  }
}

function ttlToMs(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) return 30 * 24 * 60 * 60 * 1000;
  const value = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * multipliers[unit];
}

export async function issueRefreshToken(
  userId: string,
  meta: { userAgent?: string; ip?: string } = {},
): Promise<string> {
  const raw = crypto.randomBytes(48).toString('hex');
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256(raw),
      expiresAt: new Date(Date.now() + ttlToMs(env.JWT_REFRESH_TTL)),
      userAgent: meta.userAgent,
      ip: meta.ip,
    },
  });
  return raw;
}

/** Rotates a refresh token: the presented token is revoked and a new one issued. */
export async function rotateRefreshToken(raw: string): Promise<{ userId: string; token: string }> {
  const record = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
  if (!record || record.revokedAt || record.expiresAt < new Date()) {
    throw unauthorized('Refresh token is invalid or has expired.');
  }
  await prisma.refreshToken.update({
    where: { id: record.id },
    data: { revokedAt: new Date() },
  });
  const token = await issueRefreshToken(record.userId);
  return { userId: record.userId, token };
}

export async function revokeRefreshToken(raw: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256(raw), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
