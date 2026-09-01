import { randomUUID } from 'crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import { Session, api, login, productBySku } from '../helpers';

let session: Session;

const bearer = (): string => `Bearer ${session.token}`;

beforeAll(async () => {
  session = await login();
});

describe('product archive and restore', () => {
  it('archives a product and restores it back to active', async () => {
    const unit = await prisma.unit.findFirstOrThrow({
      where: { organizationId: session.organizationId },
      select: { id: true },
    });
    const created = await api()
      .post('/api/products')
      .set('Authorization', bearer())
      .send({
        name: `Archivable ${randomUUID().slice(0, 6)}`,
        sku: `ARC-${randomUUID().slice(0, 8)}`,
        unitId: unit.id,
        productType: 'FINISHED_PRODUCT',
        purchasePrice: 10,
        sellingPrice: 20,
      })
      .expect(201);
    const id = created.body.data.id as string;

    await api().delete(`/api/products/${id}`).set('Authorization', bearer()).expect(200);
    const archived = await api().get(`/api/products/${id}`).set('Authorization', bearer());
    expect(archived.body.data.status).toBe('ARCHIVED');

    const archivedList = await api()
      .get('/api/products')
      .query({ status: 'ARCHIVED', perPage: 100 })
      .set('Authorization', bearer())
      .expect(200);
    expect((archivedList.body.data as { id: string }[]).some((row) => row.id === id)).toBe(true);

    const restored = await api()
      .post(`/api/products/${id}/restore`)
      .set('Authorization', bearer())
      .expect(200);
    expect(restored.body.data.status).toBe('ACTIVE');
    expect(restored.body.data.id).toBe(id);

    await api().post(`/api/products/${id}/restore`).set('Authorization', bearer()).expect(400);

    const audit = await prisma.auditLog.count({
      where: { entityId: id, action: 'PRODUCT_RESTORED' },
    });
    expect(audit).toBeGreaterThan(0);
  });
});

describe('units master data', () => {
  it('supports the full list, create, update, archive and restore cycle', async () => {
    const code = `U${randomUUID().slice(0, 5).toUpperCase()}`;

    const created = await api()
      .post('/api/units')
      .set('Authorization', bearer())
      .send({ name: 'Test Carton', code, dimension: 'COUNT', factorToBase: 6 })
      .expect(201);
    const id = created.body.data.id as string;

    const updated = await api()
      .put(`/api/units/${id}`)
      .set('Authorization', bearer())
      .send({ name: 'Test Carton Large', factorToBase: 12 })
      .expect(200);
    expect(updated.body.data.name).toBe('Test Carton Large');
    expect(Number(updated.body.data.factorToBase)).toBe(12);

    const list = await api()
      .get('/api/units')
      .query({ perPage: 100 })
      .set('Authorization', bearer())
      .expect(200);
    expect((list.body.data as { id: string }[]).some((row) => row.id === id)).toBe(true);

    const duplicate = await api()
      .post('/api/units')
      .set('Authorization', bearer())
      .send({ name: 'Duplicate', code })
      .expect(409);
    expect(
      (duplicate.body.error.details as { path: string }[]).some((detail) => detail.path === 'code'),
    ).toBe(true);

    const invalid = await api()
      .post('/api/units')
      .set('Authorization', bearer())
      .send({ name: '', code: '' })
      .expect(422);
    expect(invalid.body.error.details.length).toBeGreaterThan(0);

    await api().delete(`/api/units/${id}`).set('Authorization', bearer()).expect(200);
    const archived = await prisma.unit.findFirstOrThrow({ where: { id } });
    expect(archived.status).toBe('ARCHIVED');

    const restored = await api()
      .post(`/api/units/${id}/restore`)
      .set('Authorization', bearer())
      .expect(200);
    expect(restored.body.data.status).toBe('ACTIVE');
  });
});

describe('product search relevance', () => {
  it('ranks partial matches so autocomplete surfaces the right products first', async () => {
    const response = await api()
      .get('/api/products')
      .query({ search: 'iph', perPage: 10 })
      .set('Authorization', bearer())
      .expect(200);
    const names = (response.body.data as { name: string }[]).map((row) => row.name);
    expect(names.length).toBeGreaterThanOrEqual(3);
    expect(names[0]).toBe('iPhone 15');
    expect(names.every((name) => name.toLowerCase().includes('iph'))).toBe(true);

    const samsung = await api()
      .get('/api/products')
      .query({ search: 'sam', perPage: 10 })
      .set('Authorization', bearer())
      .expect(200);
    const samsungNames = (samsung.body.data as { name: string }[]).map((row) => row.name);
    expect(samsungNames.some((name) => name.startsWith('Samsung'))).toBe(true);
    expect(samsungNames[0].toLowerCase().startsWith('sam')).toBe(true);
  });

  it('finds a product by SKU fragment', async () => {
    const response = await api()
      .get('/api/products')
      .query({ search: 'MOB-SGS' })
      .set('Authorization', bearer())
      .expect(200);
    expect((response.body.data as { sku: string }[]).length).toBeGreaterThanOrEqual(2);
  });
});

describe('stock totals stay in sync with the ledger', () => {
  it('reports per-warehouse stock rows on the product list used by the UI', async () => {
    const productId = await productBySku(session.organizationId, 'MOB-IP15');
    const response = await api()
      .get('/api/products')
      .query({ search: 'iPhone 15', perPage: 10 })
      .set('Authorization', bearer())
      .expect(200);
    const row = (
      response.body.data as {
        id: string;
        stock: { warehouseId: string; quantity: string; reservedQuantity: string }[];
      }[]
    ).find((item) => item.id === productId);
    expect(row).toBeDefined();

    const ledgerRows = await prisma.inventoryStock.findMany({
      where: { productId, variantId: null },
      select: { quantity: true },
    });
    const expected = ledgerRows.reduce((sum, item) => sum + Number(item.quantity), 0);
    const reported = (row?.stock ?? []).reduce((sum, item) => sum + Number(item.quantity), 0);
    expect(reported).toBe(expected);
  });
});

describe('e-commerce only panel', () => {
  it('no longer exposes restaurant or recipe endpoints', async () => {
    for (const path of [
      '/api/restaurant/recipes',
      '/api/restaurant/orders',
      '/api/reports/food-cost',
      '/api/reports/recipe-cost',
      '/api/reports/consumption',
      '/api/dashboard/restaurant',
    ]) {
      await api().get(path).set('Authorization', bearer()).expect(404);
    }
  });

  it('exposes customers derived from e-commerce orders', async () => {
    const response = await api()
      .get('/api/ecommerce/customers')
      .set('Authorization', bearer())
      .expect(200);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.meta.total).toBeGreaterThanOrEqual(0);
  });
});
