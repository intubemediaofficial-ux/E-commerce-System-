import request, { SuperTest, Test } from 'supertest';
import { Prisma } from '@prisma/client';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';

export const api = (): SuperTest<Test> => request(createApp()) as unknown as SuperTest<Test>;

export const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'Admin@12345';

export interface Session {
  token: string;
  organizationId: string;
  userId: string;
}

export async function login(email = 'admin@demo.test'): Promise<Session> {
  const response = await api()
    .post('/api/auth/login')
    .send({ email, password: SEED_PASSWORD })
    .expect(200);
  const data = response.body.data as {
    accessToken: string;
    user: { id: string; organizationId: string };
  };
  return {
    token: data.accessToken,
    organizationId: data.user.organizationId,
    userId: data.user.id,
  };
}

export const auth = (session: Session) => (req: Test): Test =>
  req.set('Authorization', `Bearer ${session.token}`);

export async function stockQuantity(
  productId: string,
  warehouseId: string,
): Promise<{ quantity: Prisma.Decimal; reserved: Prisma.Decimal }> {
  const row = await prisma.inventoryStock.findFirst({
    where: { productId, warehouseId, variantId: null },
    select: { quantity: true, reservedQuantity: true },
  });
  return {
    quantity: row?.quantity ?? new Prisma.Decimal(0),
    reserved: row?.reservedQuantity ?? new Prisma.Decimal(0),
  };
}

export async function ledgerCount(productId: string, referenceType: string): Promise<number> {
  return prisma.inventoryLedger.count({ where: { productId, referenceType } });
}

export async function firstWarehouse(organizationId: string, code: string): Promise<string> {
  const warehouse = await prisma.warehouse.findFirstOrThrow({
    where: { organizationId, code },
    select: { id: true },
  });
  return warehouse.id;
}

export async function productBySku(organizationId: string, sku: string): Promise<string> {
  const product = await prisma.product.findFirstOrThrow({
    where: { organizationId, sku },
    select: { id: true },
  });
  return product.id;
}
