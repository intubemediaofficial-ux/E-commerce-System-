import { beforeAll, describe, expect, it } from 'vitest';
import { api, auth, login, Session } from '../helpers';

let session: Session;
let withAuth: ReturnType<typeof auth>;

beforeAll(async () => {
  session = await login();
  withAuth = auth(session);
});

describe('product register', () => {
  it('creates, lists, edits and deletes a product with the six fields only', async () => {
    const create = await withAuth(api().post('/api/products'))
      .send({
        name: `Anti Slip Tape ${Date.now()}`,
        purchasePrice: 82,
        warehouseName: 'RK Traders',
        stockDate: '2026-09-07',
        currentStock: 150,
      })
      .expect(201);

    const product = create.body.data as {
      id: string;
      currentStock: string;
      warehouseName: string;
      stockDate: string;
    };
    expect(Number(product.currentStock)).toBe(150);
    expect(product.warehouseName).toBe('RK Traders');
    expect(product.stockDate).toContain('2026-09-07');

    const list = await withAuth(api().get('/api/products').query({ status: 'ACTIVE' })).expect(200);
    const rows = list.body.data as { id: string }[];
    expect(rows.some((row) => row.id === product.id)).toBe(true);

    const updated = await withAuth(api().put(`/api/products/${product.id}`))
      .send({ currentStock: 120 })
      .expect(200);
    expect(Number((updated.body.data as { currentStock: string }).currentStock)).toBe(120);

    await withAuth(api().delete(`/api/products/${product.id}`)).expect(200);
    await withAuth(api().get(`/api/products/${product.id}`)).expect(404);
  });

  it('defaults the date to today when it is left out', async () => {
    const response = await withAuth(api().post('/api/products'))
      .send({ name: `Packing Tape ${Date.now()}`, purchasePrice: 45, currentStock: 10 })
      .expect(201);
    const product = response.body.data as { id: string; stockDate: string };
    expect(product.stockDate.slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
    await withAuth(api().delete(`/api/products/${product.id}`)).expect(200);
  });

  it('rejects a blank title and a negative stock quantity', async () => {
    await withAuth(api().post('/api/products'))
      .send({ name: '', purchasePrice: 10, currentStock: 1 })
      .expect(422);
    await withAuth(api().post('/api/products'))
      .send({ name: 'Negative stock', purchasePrice: 10, currentStock: -5 })
      .expect(422);
  });

  it('reports catalogue totals on the dashboard summary', async () => {
    const response = await withAuth(api().get('/api/dashboard/summary')).expect(200);
    const data = response.body.data as {
      totalProducts: number;
      totalStockUnits: string;
      totalPurchaseValue: string;
      recentProducts: { id: string }[];
    };
    expect(data.totalProducts).toBeGreaterThan(0);
    expect(Number(data.totalStockUnits)).toBeGreaterThan(0);
    expect(Number(data.totalPurchaseValue)).toBeGreaterThan(0);
    expect(Array.isArray(data.recentProducts)).toBe(true);
  });

  it('no longer exposes the removed inventory and purchasing modules', async () => {
    for (const path of [
      '/api/inventory',
      '/api/stock-transfers',
      '/api/purchase-orders',
      '/api/ecommerce/orders',
      '/api/reports/current-stock',
      '/api/categories',
      '/api/brands',
      '/api/units',
      '/api/warehouses',
      '/api/suppliers',
      '/api/notifications',
    ]) {
      await withAuth(api().get(path)).expect(404);
    }
  });
});
