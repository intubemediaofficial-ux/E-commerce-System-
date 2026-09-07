/* eslint-disable no-console */
import { Prisma, PrismaClient } from '@prisma/client';
import { ALL_PERMISSIONS, PERMISSIONS, ROLES } from '../src/auth/permissions';
import { hashPassword } from '../src/auth/tokens';

const prisma = new PrismaClient();

const ORG_SLUG = 'demo-commerce';
const DEVELOPMENT_PASSWORD = 'Admin@12345';
const DEFAULT_PASSWORD = process.env.SEED_PASSWORD?.trim() || DEVELOPMENT_PASSWORD;

if (
  process.env.NODE_ENV === 'production' &&
  (!process.env.SEED_PASSWORD || DEFAULT_PASSWORD === DEVELOPMENT_PASSWORD)
) {
  throw new Error(
    'SEED_PASSWORD must be set to a non-default value before seeding production data.',
  );
}

const D = (value: number | string): Prisma.Decimal => new Prisma.Decimal(value);

async function seedPermissions(): Promise<Map<string, string>> {
  for (const [slug, module] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { slug },
      update: { module },
      create: { slug, module },
    });
  }
  const rows = await prisma.permission.findMany({ select: { id: true, slug: true } });
  return new Map(rows.map((row) => [row.slug, row.id]));
}

async function seedRoles(
  organizationId: string,
  permissionIds: Map<string, string>,
): Promise<Map<string, string>> {
  const roleIds = new Map<string, string>();

  for (const [slug, definition] of Object.entries(ROLES)) {
    const role = await prisma.role.upsert({
      where: { organizationId_slug: { organizationId, slug } },
      update: { name: definition.name, isSystem: true },
      create: { organizationId, slug, name: definition.name, isSystem: true },
    });
    roleIds.set(slug, role.id);

    const permissions = definition.permissions === 'ALL' ? ALL_PERMISSIONS : definition.permissions;

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: permissions
        .map((slugName) => permissionIds.get(slugName))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({ roleId: role.id, permissionId })),
      skipDuplicates: true,
    });
  }

  return roleIds;
}

async function seedUsers(organizationId: string, roleIds: Map<string, string>): Promise<void> {
  const people = [
    { email: 'superadmin@demo.test', name: 'Super Admin', role: 'super_admin' },
    { email: 'admin@demo.test', name: 'Business Admin', role: 'admin' },
  ];

  const passwordHash = await hashPassword(DEFAULT_PASSWORD);

  for (const person of people) {
    const user = await prisma.user.upsert({
      where: { organizationId_email: { organizationId, email: person.email } },
      update: { name: person.name, status: 'ACTIVE' },
      create: {
        organizationId,
        name: person.name,
        email: person.email,
        passwordHash,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });

    const roleId = roleIds.get(person.role);
    if (roleId) {
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId } },
        update: {},
        create: { userId: user.id, roleId },
      });
    }
  }
}

async function main(): Promise<void> {
  const permissionIds = await seedPermissions();

  const organization = await prisma.organization.upsert({
    where: { slug: ORG_SLUG },
    update: { name: 'Demo Commerce Pvt Ltd' },
    create: {
      name: 'Demo Commerce Pvt Ltd',
      slug: ORG_SLUG,
      email: 'ops@demo.test',
      phone: '+911234567890',
      currency: 'INR',
      settings: { create: {} },
    },
  });
  const organizationId = organization.id;
  await prisma.organizationSettings.upsert({
    where: { organizationId },
    update: {},
    create: { organizationId },
  });

  const roleIds = await seedRoles(organizationId, permissionIds);
  await seedUsers(organizationId, roleIds);

  // Products are stored against a single "pieces" unit; the panel never asks
  // for it, so the seed only has to make sure the row exists.
  const unit = await prisma.unit.upsert({
    where: { organizationId_code: { organizationId, code: 'PCS' } },
    update: { name: 'Pieces' },
    create: {
      organizationId,
      code: 'PCS',
      name: 'Pieces',
      dimension: 'COUNT',
      factorToBase: D(1),
      isBase: true,
    },
  });

  const sampleProducts = [
    { sku: 'ANTI-SLIP-TAPE-10M', name: '10 Meter Anti Slip Tape', purchasePrice: 82, stock: 150 },
    { sku: 'PACKING-TAPE-50M', name: 'Packing Tape 50 Meter', purchasePrice: 45, stock: 320 },
    { sku: 'SHIPPING-BOX-MEDIUM', name: 'Shipping Box (Medium)', purchasePrice: 12, stock: 500 },
  ];

  for (const spec of sampleProducts) {
    await prisma.product.upsert({
      where: { organizationId_sku: { organizationId, sku: spec.sku } },
      update: { name: spec.name },
      create: {
        organizationId,
        name: spec.name,
        sku: spec.sku,
        unitId: unit.id,
        purchasePrice: D(spec.purchasePrice),
        warehouseName: 'RK Traders',
        stockDate: new Date(),
        currentStock: D(spec.stock),
      },
    });
  }

  console.log('Seed complete');
  console.log(`Organization: ${organization.name} (${ORG_SLUG})`);
  console.log(`Full-access admin: admin@demo.test / ${DEFAULT_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
