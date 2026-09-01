import { randomUUID } from 'crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma';
import {
  Session,
  api,
  firstWarehouse,
  ledgerCount,
  login,
  productBySku,
  stockQuantity,
} from '../helpers';

let session: Session;
let mainWarehouse: string;
let storeWarehouse: string;
let supplierId: string;

const bearer = (): string => `Bearer ${session.token}`;

beforeAll(async () => {
  session = await login();
  mainWarehouse = await firstWarehouse(session.organizationId, 'JAI-MAIN');
  storeWarehouse = await firstWarehouse(session.organizationId, 'JAI-STORE');
  const supplier = await prisma.supplier.findFirstOrThrow({
    where: { organizationId: session.organizationId },
    select: { id: true },
  });
  supplierId = supplier.id;
});

describe('authentication and authorization', () => {
  it('rejects unauthenticated API access', async () => {
    const response = await api().get('/api/products').expect(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a wrong password', async () => {
    await api()
      .post('/api/auth/login')
      .send({ email: 'admin@demo.test', password: 'not-the-password' })
      .expect(401);
  });

  it('gives the admin every permission in the catalog', async () => {
    const response = await api()
      .get('/api/admin/permissions')
      .set('Authorization', bearer())
      .expect(200);
    const catalog = Object.keys(response.body.data.catalog as Record<string, string>);
    const admin = await api().post('/api/auth/login').send({
      email: 'admin@demo.test',
      password: process.env.SEED_PASSWORD ?? 'Admin@12345',
    });
    const granted = admin.body.data.user.permissions as string[];
    expect(catalog.every((permission) => granted.includes(permission))).toBe(true);
  });

  it('denies an accountant access to admin user management', async () => {
    const accountsSession = await login('accounts@demo.test');
    const response = await api()
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${accountsSession.token}`)
      .expect(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });
});

describe('products', () => {
  it('creates a product and rejects a duplicate SKU', async () => {
    const unit = await prisma.unit.findFirstOrThrow({
      where: { organizationId: session.organizationId, code: 'PCS' },
      select: { id: true },
    });
    const sku = `TEST-${randomUUID().slice(0, 8)}`;
    const payload = {
      name: `Test Product ${sku}`,
      sku,
      unitId: unit.id,
      productType: 'FINISHED_PRODUCT',
      purchasePrice: 100,
      sellingPrice: 150,
      reorderLevel: 5,
    };
    const created = await api()
      .post('/api/products')
      .set('Authorization', bearer())
      .send(payload)
      .expect(201);
    expect(created.body.data.sku).toBe(sku);

    const duplicate = await api()
      .post('/api/products')
      .set('Authorization', bearer())
      .send(payload)
      .expect(409);
    expect(duplicate.body.error.code).toBe('DUPLICATE_SKU');
  });

  it('rejects a negative selling price', async () => {
    const unit = await prisma.unit.findFirstOrThrow({
      where: { organizationId: session.organizationId, code: 'PCS' },
      select: { id: true },
    });
    const response = await api()
      .post('/api/products')
      .set('Authorization', bearer())
      .send({
        name: 'Invalid product',
        sku: `BAD-${randomUUID().slice(0, 8)}`,
        unitId: unit.id,
        productType: 'FINISHED_PRODUCT',
        sellingPrice: -1,
      })
      .expect(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('purchase to stock workflow', () => {
  it('receives a purchase order partially and then fully', async () => {
    const productId = await productBySku(session.organizationId, 'MOB-IP15');
    const before = await stockQuantity(productId, mainWarehouse);

    const po = await api()
      .post('/api/purchase-orders')
      .set('Authorization', bearer())
      .send({
        supplierId,
        warehouseId: mainWarehouse,
        submit: true,
        items: [{ productId, quantity: 100, unitCost: 9 }],
      })
      .expect(201);
    const poId = po.body.data.id as string;
    const itemId = po.body.data.items[0].id as string;

    await api()
      .post(`/api/purchase-orders/${poId}/approve`)
      .set('Authorization', bearer())
      .expect(200);

    const partial = await api()
      .post(`/api/purchase-orders/${poId}/receive`)
      .set('Authorization', bearer())
      .send({ items: [{ purchaseOrderItemId: itemId, quantity: 60, batchNumber: 'B-1' }] })
      .expect(201);
    expect(partial.body.data.grnNumber).toBeTruthy();

    let po_ = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
    expect(po_.status).toBe('PARTIALLY_RECEIVED');

    await api()
      .post(`/api/purchase-orders/${poId}/receive`)
      .set('Authorization', bearer())
      .send({ items: [{ purchaseOrderItemId: itemId, quantity: 40, batchNumber: 'B-2' }] })
      .expect(201);

    po_ = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId } });
    expect(po_.status).toBe('FULLY_RECEIVED');

    const after = await stockQuantity(productId, mainWarehouse);
    expect(after.quantity.minus(before.quantity).toNumber()).toBe(100);
    expect(await ledgerCount(productId, 'GOODS_RECEIPT')).toBeGreaterThan(0);

    const overReceive = await api()
      .post(`/api/purchase-orders/${poId}/receive`)
      .set('Authorization', bearer())
      .send({ items: [{ purchaseOrderItemId: itemId, quantity: 5 }] })
      .expect(409);
    expect(overReceive.body.error.code).toBe('INVALID_STATE');
  });
});

describe('adjustments, wastage and idempotency', () => {
  it('blocks an adjustment that would drive stock negative', async () => {
    const unit = await prisma.unit.findFirstOrThrow({
      where: { organizationId: session.organizationId, code: 'PCS' },
      select: { id: true },
    });
    const product = await prisma.product.create({
      data: {
        organizationId: session.organizationId,
        name: `Empty stock product ${randomUUID().slice(0, 6)}`,
        sku: `EMPTY-${randomUUID().slice(0, 8)}`,
        productType: 'FINISHED_PRODUCT',
        unitId: unit.id,
      },
      select: { id: true },
    });

    const response = await api()
      .post('/api/inventory/adjust')
      .set('Authorization', bearer())
      .send({
        warehouseId: mainWarehouse,
        reason: 'PHYSICAL_COUNT',
        items: [{ productId: product.id, quantityChange: -25, unitCost: 1 }],
      })
      .expect(409);
    expect(response.body.error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('routes a high-value adjustment to approval instead of moving stock', async () => {
    const productId = await productBySku(session.organizationId, 'ACC-CBL20');
    const before = await stockQuantity(productId, mainWarehouse);
    const response = await api()
      .post('/api/inventory/adjust')
      .set('Authorization', bearer())
      .send({
        warehouseId: mainWarehouse,
        reason: 'PHYSICAL_COUNT',
        items: [{ productId, quantityChange: -600, unitCost: 100 }],
      })
      .expect(201);
    expect(response.body.data.status).toBe('PENDING_APPROVAL');

    const after = await stockQuantity(productId, mainWarehouse);
    expect(after.quantity.toNumber()).toBe(before.quantity.toNumber());
  });

  it('deducts wastage exactly once for a repeated idempotency key', async () => {
    const productId = await productBySku(session.organizationId, 'MOB-SGA55');
    // Top the store up first so repeated test runs never exhaust the seeded stock.
    await api()
      .post('/api/inventory/adjust')
      .set('Authorization', bearer())
      .send({
        warehouseId: storeWarehouse,
        reason: 'PHYSICAL_COUNT',
        items: [{ productId, quantityChange: 20, unitCost: 1 }],
      })
      .expect(201);
    const before = await stockQuantity(productId, storeWarehouse);
    const key = randomUUID();
    const body = {
      productId,
      warehouseId: storeWarehouse,
      quantity: 5,
      reason: 'SPOILAGE',
      notes: 'integration test',
    };

    await api()
      .post('/api/inventory/wastage')
      .set('Authorization', bearer())
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    await api()
      .post('/api/inventory/wastage')
      .set('Authorization', bearer())
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);

    const after = await stockQuantity(productId, storeWarehouse);
    expect(before.quantity.minus(after.quantity).toNumber()).toBe(5);
  });
});

describe('stock transfer workflow', () => {
  it('moves stock from source to destination through the ledger', async () => {
    const productId = await productBySku(session.organizationId, 'PKG-BOX');
    // Keep the source stocked so repeated test runs stay independent.
    await api()
      .post('/api/inventory/adjust')
      .set('Authorization', bearer())
      .send({
        warehouseId: mainWarehouse,
        reason: 'PHYSICAL_COUNT',
        items: [{ productId, quantityChange: 50, unitCost: 1 }],
      })
      .expect(201);
    const sourceBefore = await stockQuantity(productId, mainWarehouse);
    const destBefore = await stockQuantity(productId, storeWarehouse);

    const transfer = await api()
      .post('/api/stock-transfers')
      .set('Authorization', bearer())
      .send({
        sourceWarehouseId: mainWarehouse,
        destinationWarehouseId: storeWarehouse,
        submit: true,
        items: [{ productId, quantity: 50 }],
      })
      .expect(201);
    const id = transfer.body.data.id as string;

    await api().post(`/api/stock-transfers/${id}/approve`).set('Authorization', bearer()).expect(200);
    await api()
      .post(`/api/stock-transfers/${id}/dispatch`)
      .set('Authorization', bearer())
      .expect(200);

    const dispatched = await stockQuantity(productId, mainWarehouse);
    expect(sourceBefore.quantity.minus(dispatched.quantity).toNumber()).toBe(50);

    await api().post(`/api/stock-transfers/${id}/receive`).set('Authorization', bearer()).expect(200);

    const destAfter = await stockQuantity(productId, storeWarehouse);
    expect(destAfter.quantity.minus(destBefore.quantity).toNumber()).toBe(50);

    const record = await prisma.stockTransfer.findUniqueOrThrow({ where: { id } });
    expect(record.status).toBe('COMPLETED');
  });
});

describe('e-commerce reservation workflow', () => {
  it('reserves on confirm, deducts on ship and never oversells', async () => {
    const productId = await productBySku(session.organizationId, 'GRO-005');
    const before = await stockQuantity(productId, mainWarehouse);
    expect(before.quantity.toNumber()).toBeGreaterThan(3);

    const order = await api()
      .post('/api/ecommerce/orders')
      .set('Authorization', bearer())
      .send({
        warehouseId: mainWarehouse,
        customerName: 'Test Customer',
        items: [{ productId, quantity: 2 }],
      })
      .expect(201);
    const orderId = order.body.data.id as string;

    await api()
      .post(`/api/ecommerce/orders/${orderId}/confirm`)
      .set('Authorization', bearer())
      .expect(200);

    const reserved = await stockQuantity(productId, mainWarehouse);
    expect(reserved.reserved.minus(before.reserved).toNumber()).toBe(2);
    expect(reserved.quantity.toNumber()).toBe(before.quantity.toNumber());

    await api().post(`/api/ecommerce/orders/${orderId}/pack`).set('Authorization', bearer()).expect(200);
    await api().post(`/api/ecommerce/orders/${orderId}/ship`).set('Authorization', bearer()).expect(200);

    const shipped = await stockQuantity(productId, mainWarehouse);
    expect(before.quantity.minus(shipped.quantity).toNumber()).toBe(2);
    expect(shipped.reserved.toNumber()).toBe(before.reserved.toNumber());

    const cancelAfterShip = await api()
      .post(`/api/ecommerce/orders/${orderId}/cancel`)
      .set('Authorization', bearer())
      .expect(409);
    expect(cancelAfterShip.body.error.code).toBe('INVALID_STATE');
  });

  it('reserves bundle components instead of the bundle product', async () => {
    const bundleProductId = await productBySku(session.organizationId, 'GRO-001');
    const componentId = await productBySku(session.organizationId, 'GRO-003');
    const componentBefore = await stockQuantity(componentId, mainWarehouse);

    const order = await api()
      .post('/api/ecommerce/orders')
      .set('Authorization', bearer())
      .send({ warehouseId: mainWarehouse, items: [{ productId: bundleProductId, quantity: 2 }] })
      .expect(201);

    await api()
      .post(`/api/ecommerce/orders/${order.body.data.id}/confirm`)
      .set('Authorization', bearer())
      .expect(200);

    const componentAfter = await stockQuantity(componentId, mainWarehouse);
    expect(componentAfter.reserved.minus(componentBefore.reserved).toNumber()).toBe(4);
  });

  it('releases reservations when an order is cancelled', async () => {
    const productId = await productBySku(session.organizationId, 'GRO-002');
    const before = await stockQuantity(productId, mainWarehouse);

    const order = await api()
      .post('/api/ecommerce/orders')
      .set('Authorization', bearer())
      .send({ warehouseId: mainWarehouse, items: [{ productId, quantity: 3 }] })
      .expect(201);
    const orderId = order.body.data.id as string;

    await api()
      .post(`/api/ecommerce/orders/${orderId}/confirm`)
      .set('Authorization', bearer())
      .expect(200);
    await api()
      .post(`/api/ecommerce/orders/${orderId}/cancel`)
      .set('Authorization', bearer())
      .expect(200);

    const after = await stockQuantity(productId, mainWarehouse);
    expect(after.reserved.toNumber()).toBe(before.reserved.toNumber());
    expect(after.quantity.toNumber()).toBe(before.quantity.toNumber());

    const reservations = await prisma.inventoryReservation.findMany({ where: { orderId } });
    expect(reservations.every((r) => r.status === 'RELEASED')).toBe(true);
  });

  it('refuses to reserve more than the available quantity', async () => {
    const productId = await productBySku(session.organizationId, 'GRO-003');
    const stock = await stockQuantity(productId, mainWarehouse);

    const order = await api()
      .post('/api/ecommerce/orders')
      .set('Authorization', bearer())
      .send({
        warehouseId: mainWarehouse,
        items: [{ productId, quantity: stock.quantity.plus(1000).toNumber() }],
      })
      .expect(201);

    const response = await api()
      .post(`/api/ecommerce/orders/${order.body.data.id}/confirm`)
      .set('Authorization', bearer())
      .expect(409);
    expect(response.body.error.code).toBe('INSUFFICIENT_STOCK');
  });
});

describe('reports and dashboards', () => {
  it('exposes the ledger as an immutable audit trail', async () => {
    const response = await api()
      .get('/api/inventory/ledger?perPage=5')
      .set('Authorization', bearer())
      .expect(200);
    expect(response.body.data.length).toBeGreaterThan(0);
  });

  it('exports a report as CSV', async () => {
    const response = await api()
      .get('/api/reports/current-stock?format=csv')
      .set('Authorization', bearer())
      .expect(200);
    expect(response.headers['content-type']).toContain('csv');
    expect(response.text.split('\n').length).toBeGreaterThan(1);
  });

  it('returns admin dashboard KPIs', async () => {
    const response = await api()
      .get('/api/dashboard/admin')
      .set('Authorization', bearer())
      .expect(200);
    expect(response.body.data.totalProducts).toBeGreaterThan(0);
    expect(response.body.data).toHaveProperty('totalInventoryValue');
    expect(response.body.data).toHaveProperty('lowStockCount');
    expect(response.body.data).toHaveProperty('outOfStockCount');
  });
});

describe('tenant isolation', () => {
  it('hides another organization data', async () => {
    const other = await prisma.organization.create({
      data: { name: 'Other Org', slug: `other-${randomUUID().slice(0, 8)}` },
    });
    const otherProduct = await prisma.product.create({
      data: {
        organizationId: other.id,
        name: 'Foreign product',
        sku: `FOR-${randomUUID().slice(0, 8)}`,
        productType: 'FINISHED_PRODUCT',
        unitId: (
          await prisma.unit.create({
            data: {
              organizationId: other.id,
              code: 'PCS',
              name: 'Piece',
              dimension: 'COUNT',
              factorToBase: 1,
              isBase: true,
            },
          })
        ).id,
      },
    });

    const response = await api()
      .get(`/api/products/${otherProduct.id}`)
      .set('Authorization', bearer())
      .expect(404);
    expect(response.body.success).toBe(false);
  });
});

describe('bulk import, export and scan lookup', () => {
  it('resolves a SKU through the scanner lookup endpoint', async () => {
    const response = await api()
      .get('/api/products/lookup')
      .query({ code: 'ACC-CBL20' })
      .set('Authorization', bearer())
      .expect(200);
    expect(response.body.data.product.sku).toBe('ACC-CBL20');
    expect(Array.isArray(response.body.data.product.stock)).toBe(true);
  });

  it('returns PRODUCT_NOT_FOUND for an unknown scan code', async () => {
    const response = await api()
      .get('/api/products/lookup')
      .query({ code: 'NO-SUCH-CODE' })
      .set('Authorization', bearer())
      .expect(404);
    expect(response.body.error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('exports products as CSV', async () => {
    const response = await api()
      .get('/api/products/export')
      .query({ format: 'csv' })
      .set('Authorization', bearer())
      .expect(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.text.split('\n')[0]).toContain('SKU');
    expect(response.text).toContain('ACC-CBL20');
  });

  it('imports products from CSV and reports per-row errors', async () => {
    const sku = `IMP-${randomUUID().slice(0, 8)}`;
    const csv = [
      'sku,name,unit,productType,purchasePrice,sellingPrice,reorderLevel',
      `${sku},Imported Product,PCS,FINISHED_PRODUCT,12.5,20,5`,
      `${sku}-BAD,Bad Unit Product,NOPE,FINISHED_PRODUCT,1,2,0`,
    ].join('\n');

    const response = await api()
      .post('/api/products/import')
      .set('Authorization', bearer())
      .send({ csv })
      .expect(200);
    expect(response.body.data.created).toBe(1);
    expect(response.body.data.errors).toHaveLength(1);

    const product = await prisma.product.findFirstOrThrow({
      where: { organizationId: session.organizationId, sku },
    });
    expect(product.sellingPrice.toNumber()).toBe(20);

    const rerun = await api()
      .post('/api/products/import')
      .set('Authorization', bearer())
      .send({ csv: `sku,name,unit,sellingPrice\n${sku},Imported Product,PCS,25` })
      .expect(200);
    expect(rerun.body.data.updated).toBe(1);
  });

  it('imports opening stock through the ledger', async () => {
    const productId = await productBySku(session.organizationId, 'GRO-010');
    const before = await stockQuantity(productId, mainWarehouse);
    const ledgerBefore = await ledgerCount(productId, 'OPENING_STOCK_IMPORT');

    const response = await api()
      .post('/api/inventory/opening-stock/import')
      .set('Authorization', bearer())
      .send({ csv: 'sku,warehouseCode,quantity,unitCost\nGRO-010,JAI-MAIN,15,9.5\nNOPE,JAI-MAIN,4,1' })
      .expect(200);
    expect(response.body.data.applied).toBe(1);
    expect(response.body.data.errors).toHaveLength(1);

    const after = await stockQuantity(productId, mainWarehouse);
    expect(after.quantity.minus(before.quantity).toNumber()).toBe(15);
    expect(await ledgerCount(productId, 'OPENING_STOCK_IMPORT')).toBe(ledgerBefore + 1);
  });
});
