import { prisma } from '../../lib/prisma';
import { unauthorized } from '../../lib/errors';
import { AccessTokenPayload, signAccessToken, verifyPassword } from '../../auth/tokens';

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  organizationId: string;
  organizationName: string;
  roles: string[];
  permissions: string[];
}

export async function loadUserContext(userId: string): Promise<AuthenticatedUser> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      organization: { select: { id: true, name: true, status: true } },
      userRoles: {
        include: {
          role: { include: { rolePermissions: { include: { permission: true } } } },
        },
      },
    },
  });
  if (!user || user.status !== 'ACTIVE' || user.organization.status !== 'ACTIVE') {
    throw unauthorized('Account is not active.');
  }

  const roles = user.userRoles.map((ur) => ur.role.slug);
  const permissions = [
    ...new Set(
      user.userRoles.flatMap((ur) => ur.role.rolePermissions.map((rp) => rp.permission.slug)),
    ),
  ];

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    organizationId: user.organizationId,
    organizationName: user.organization.name,
    roles,
    permissions,
  };
}

export function toAccessPayload(user: AuthenticatedUser): AccessTokenPayload {
  return {
    sub: user.id,
    organizationId: user.organizationId,
    email: user.email,
    roles: user.roles,
    permissions: user.permissions,
  };
}

export const issueAccessToken = (user: AuthenticatedUser) => signAccessToken(toAccessPayload(user));

export async function authenticateWithPassword(
  email: string,
  password: string,
): Promise<AuthenticatedUser> {
  const user = await prisma.user.findFirst({
    where: { email: email.toLowerCase() },
    select: { id: true, passwordHash: true, status: true },
  });
  // Always run a verification to keep the response time uniform.
  const hash = user?.passwordHash ?? '$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const valid = await verifyPassword(hash, password);
  if (!user || !valid) throw unauthorized('Invalid email or password.');
  const context = await loadUserContext(user.id);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return context;
}
