/* eslint-disable no-console */
import { Prisma, PrismaClient, ProductType, WarehouseType } from '@prisma/client';
import { ALL_PERMISSIONS, PERMISSIONS, ROLES } from '../src/auth/permissions';
import { hashPassword } from '../src/auth/tokens';
import { receiveStock } from '../src/services/inventory.service';

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

    const permissions =
      definition.permissions === 'ALL' ? ALL_PERMISSIONS : definition.permissions;

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

async function seedUsers(
  organizationId: string,
  roleIds: Map<string, string>,
): Promise<Map<string, string>> {
  const people: { email: string; name: string; role: string }[] = [
    { email: 'superadmin@demo.test', name: 'Super Admin', role: 'super_admin' },
    { email: 'admin@demo.test', name: 'Business Admin', role: 'admin' },
    { email: 'inventory@demo.test', name: 'Inventory Manager', role: 'inventory_manager' },
    { email: 'purchase@demo.test', name: 'Purchase Manager', role: 'purchase_manager' },
    { email: 'sales@demo.test', name: 'Sales Manager', role: 'sales_manager' },
    { email: 'accounts@demo.test', name: 'Accountant', role: 'accountant' },
  ];

  const passwordHash = await hashPassword(DEFAULT_PASSWORD);
  const userIds = new Map<string, string>();

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
    userIds.set(person.role, user.id);

    const roleId = roleIds.get(person.role);
    if (roleId) {
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId } },
        update: {},
        create: { userId: user.id, roleId },
      });
    }
  }

  return userIds;
}

async function main(): Promise<void> {
  const permissionIds = await seedPermissions();

  // Legacy demo data used a restaurant-flavoured slug before the panel became
  // e-commerce only; rename it in place so reseeding never forks a second org.
  await prisma.organization.updateMany({
    where: { slug: 'demo-foods' },
    data: { slug: ORG_SLUG },
  });

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
  const userIds = await seedUsers(organizationId, roleIds);
  const adminId = userIds.get('admin') ?? null;

  // Units -------------------------------------------------------------------
  const unitSpecs = [
    { code: 'PCS', name: 'Piece', dimension: 'COUNT', factorToBase: 1, isBase: true },
    { code: 'DOZ', name: 'Dozen', dimension: 'COUNT', factorToBase: 12, isBase: false },
    { code: 'G', name: 'Gram', dimension: 'WEIGHT', factorToBase: 1, isBase: true },
    { code: 'KG', name: 'Kilogram', dimension: 'WEIGHT', factorToBase: 1000, isBase: false },
    { code: 'ML', name: 'Millilitre', dimension: 'VOLUME', factorToBase: 1, isBase: true },
    { code: 'L', name: 'Litre', dimension: 'VOLUME', factorToBase: 1000, isBase: false },
    { code: 'BOX', name: 'Box', dimension: 'COUNT', factorToBase: 24, isBase: false },
    { code: 'PKT', name: 'Packet', dimension: 'COUNT', factorToBase: 1, isBase: false },
  ];
  const units = new Map<string, string>();
  for (const unit of unitSpecs) {
    const row = await prisma.unit.upsert({
      where: { organizationId_code: { organizationId, code: unit.code } },
      update: { name: unit.name, dimension: unit.dimension, factorToBase: D(unit.factorToBase), isBase: unit.isBase },
      create: { organizationId, ...unit, factorToBase: D(unit.factorToBase) },
    });
    units.set(unit.code, row.id);
  }

  // Locations & warehouses ---------------------------------------------------
  const locationSpecs = [
    { code: 'JAI', name: 'Jaipur Branch', city: 'Jaipur' },
    { code: 'DEL', name: 'Delhi Branch', city: 'Delhi' },
    { code: 'BLR', name: 'Bengaluru Branch', city: 'Bengaluru' },
  ];
  const locations = new Map<string, string>();
  for (const location of locationSpecs) {
    const row = await prisma.location.upsert({
      where: { organizationId_code: { organizationId, code: location.code } },
      update: { name: location.name },
      create: { organizationId, ...location, state: 'IN', country: 'India' },
    });
    locations.set(location.code, row.id);
  }

  const warehouseSpecs: { code: string; name: string; type: WarehouseType; location: string }[] = [
    { code: 'JAI-MAIN', name: 'Jaipur Main Warehouse', type: 'MAIN_WAREHOUSE', location: 'JAI' },
    { code: 'JAI-STORE', name: 'Jaipur Retail Store', type: 'RETAIL_STORE', location: 'JAI' },
    { code: 'DEL-MAIN', name: 'Delhi Warehouse', type: 'BRANCH_WAREHOUSE', location: 'DEL' },
    { code: 'DEL-PACK', name: 'Delhi Packaging Store', type: 'PACKAGING_STORE', location: 'DEL' },
    { code: 'BLR-COLD', name: 'Bengaluru Cold Storage', type: 'COLD_STORAGE', location: 'BLR' },
  ];
  const warehouses = new Map<string, string>();
  for (const warehouse of warehouseSpecs) {
    const row = await prisma.warehouse.upsert({
      where: { organizationId_code: { organizationId, code: warehouse.code } },
      update: { name: warehouse.name, type: warehouse.type },
      create: {
        organizationId,
        code: warehouse.code,
        name: warehouse.name,
        type: warehouse.type,
        locationId: locations.get(warehouse.location) ?? null,
        managerId: userIds.get('inventory_manager') ?? null,
      },
    });
    warehouses.set(warehouse.code, row.id);
  }

  // Categories --------------------------------------------------------------
  const categoryTree: Record<string, string[]> = {
    Electronics: ['Mobiles', 'Laptops', 'Audio', 'Accessories'],
    Fashion: ['Apparel', 'Footwear', 'Bags'],
    Home: ['Kitchenware', 'Furnishing', 'Beauty'],
    Grocery: ['Beverages', 'Snacks', 'Bakery', 'Dairy', 'Spices', 'Grains'],
    Supplies: ['Packaging', 'Disposables'],
  };
  const categories = new Map<string, string>();
  for (const [parentName, children] of Object.entries(categoryTree)) {
    const existingParent = await prisma.category.findFirst({
      where: { organizationId, name: parentName, parentCategoryId: null },
    });
    const parent =
      existingParent ?? (await prisma.category.create({ data: { organizationId, name: parentName } }));
    categories.set(parentName, parent.id);
    for (const child of children) {
      const row = await prisma.category.upsert({
        where: {
          organizationId_name_parentCategoryId: {
            organizationId,
            name: child,
            parentCategoryId: parent.id,
          },
        },
        update: {},
        create: { organizationId, name: child, parentCategoryId: parent.id },
      });
      categories.set(child, row.id);
    }
  }

  const brands = new Map<string, string>();
  for (const name of ['Demo House', 'FreshFarm', 'DailyBake', 'UrbanWear', 'TechLine']) {
    const row = await prisma.brand.upsert({
      where: { organizationId_name: { organizationId, name } },
      update: {},
      create: { organizationId, name },
    });
    brands.set(name, row.id);
  }

  // Suppliers ---------------------------------------------------------------
  const suppliers = new Map<string, string>();
  for (let i = 1; i <= 10; i += 1) {
    const name = `Supplier ${String(i).padStart(2, '0')}`;
    const row = await prisma.supplier.upsert({
      where: { organizationId_name: { organizationId, name } },
      update: {},
      create: {
        organizationId,
        name,
        companyName: `${name} Trading Co.`,
        email: `supplier${i}@demo.test`,
        phone: `+9198000000${String(i).padStart(2, '0')}`,
        paymentTerms: i % 2 === 0 ? 'NET15' : 'NET30',
        creditLimit: D(50_000 * i),
      },
    });
    suppliers.set(name, row.id);
  }

  // Products ---------------------------------------------------------------
  interface ProductSpec {
    sku: string;
    name: string;
    type: ProductType;
    unit: string;
    category: string;
    purchasePrice: number;
    sellingPrice: number;
    perishable?: boolean;
    trackBatches?: boolean;
    reorderLevel: number;
  }

  // A realistic e-commerce catalogue: recognisable brands make search demos useful.
  const featuredSpecs: ProductSpec[] = [
    { sku: 'MOB-IP15', name: 'iPhone 15', type: 'FINISHED_PRODUCT', unit: 'PCS', category: 'Mobiles', purchasePrice: 62000, sellingPrice: 74900, reorderLevel: 5 },
    { sku: 'MOB-IP15P', name: 'iPhone 15 Pro', type: 'FINISHED_PRODUCT', unit: 'PCS', category: 'Mobiles', purchasePrice: 108000, sellingPrice: 129900, reorderLevel: 5 },
    { sku: 'MOB-IP15PM', name: 'iPhone 15 Pro Max', type: 'FINISHED_PRODUCT', unit: 'PCS', category: 'Mobiles', purchasePrice: 132000, sellingPrice: 159900, reorderLevel: 5 },
    { sku: 'MOB-SGS24', name: 'Samsung Galaxy S24', type: 'FINISHED_PRODUCT', unit: 'PCS', category: 'Mobiles', purchasePrice: 58000, sellingPrice: 74999, reorderLevel: 5 },
    { sku: 'MOB-SGS24U', name: 'Samsung Galaxy S24 Ultra', type: 'FINISHED_PRODUCT', unit: 'PCS', category: 'Mobiles', purchasePrice: 105000, sellingPrice: 129999, reorderLevel: 5 },
    { sku: 'MOB-SGA55', name: 'Samsung Galaxy A55', type: 'FINISHED_PRODUCT', unit: 'PCS', category: 'Mobiles', purchasePrice: 32000, sellingPrice: 39999, reorderLevel: 8 },
    { sku: 'LAP-MBA13', name: 'MacBook Air 13 M3', type: 'FINISHED_PRODUCT', unit: 'PCS', category: 'Laptops', purchasePrice: 92000, sellingPrice: 114900, reorderLevel: 3 },
    { sku: 'AUD-APP2', name: 'AirPods Pro 2', type: 'FINISHED_PRODUCT', unit: 'PCS', category: 'Audio', purchasePrice: 19000, sellingPrice: 24900, reorderLevel: 10 },
    { sku: 'AUD-SGB3', name: 'Samsung Galaxy Buds 3', type: 'FINISHED_PRODUCT', unit: 'PCS', category: 'Audio', purchasePrice: 9500, sellingPrice: 12999, reorderLevel: 10 },
    { sku: 'ACC-CBL20', name: 'USB-C Cable 2 m', type: 'FINISHED_PRODUCT', unit: 'PCS', category: 'Accessories', purchasePrice: 220, sellingPrice: 499, reorderLevel: 50 },
    { sku: 'PKG-BOX', name: 'Shipping Box (Medium)', type: 'PACKAGING_MATERIAL', unit: 'PCS', category: 'Packaging', purchasePrice: 12, sellingPrice: 0, reorderLevel: 300 },
    { sku: 'PKG-WRAP', name: 'Bubble Wrap Roll', type: 'PACKAGING_MATERIAL', unit: 'PCS', category: 'Packaging', purchasePrice: 180, sellingPrice: 0, reorderLevel: 40 },
  ];

  const retailSpecs: ProductSpec[] = Array.from({ length: 40 }, (_, index) => {
    const number = index + 1;
    const categoryNames = ['Apparel', 'Footwear', 'Kitchenware', 'Beauty'];
    return {
      sku: `RET-${String(number).padStart(3, '0')}`,
      name: `Retail Product ${number}`,
      type: 'FINISHED_PRODUCT' as ProductType,
      unit: 'PCS',
      category: categoryNames[index % categoryNames.length],
      purchasePrice: 100 + number * 5,
      sellingPrice: 180 + number * 8,
      reorderLevel: 10,
    };
  });

  const grocerySpecs: ProductSpec[] = Array.from({ length: 45 }, (_, index) => {
    const number = index + 1;
    const categoryNames = ['Beverages', 'Snacks', 'Bakery', 'Dairy', 'Spices'];
    return {
      sku: `GRO-${String(number).padStart(3, '0')}`,
      name: `Grocery Product ${number}`,
      type: 'FINISHED_PRODUCT' as ProductType,
      unit: number % 3 === 0 ? 'G' : 'PCS',
      category: categoryNames[index % categoryNames.length],
      purchasePrice: 20 + number,
      sellingPrice: 35 + number * 2,
      reorderLevel: 25,
      perishable: number % 4 === 0,
      trackBatches: number % 4 === 0,
    };
  });

  const allSpecs = [...featuredSpecs, ...retailSpecs, ...grocerySpecs];
  const products = new Map<string, string>();
  for (const spec of allSpecs) {
    const row = await prisma.product.upsert({
      where: { organizationId_sku: { organizationId, sku: spec.sku } },
      update: { name: spec.name },
      create: {
        organizationId,
        name: spec.name,
        sku: spec.sku,
        barcode: `890${spec.sku.replace(/[^0-9]/g, '').padStart(9, '0')}`,
        productType: spec.type,
        unitId: units.get(spec.unit) ?? units.get('PCS')!,
        categoryId: categories.get(spec.category) ?? null,
        brandId: brands.get('Demo House') ?? null,
        purchasePrice: D(spec.purchasePrice),
        sellingPrice: D(spec.sellingPrice),
        taxRate: D(5),
        reorderLevel: D(spec.reorderLevel),
        minimumStockLevel: D(spec.reorderLevel),
        isPerishable: spec.perishable ?? false,
        trackBatches: spec.trackBatches ?? false,
        shelfLifeDays: spec.perishable ? 10 : null,
      },
    });
    products.set(spec.sku, row.id);
  }

  // Variants for one retail product ----------------------------------------
  const tshirtId = products.get('RET-001');
  if (tshirtId) {
    for (const variant of [
      { sku: 'RET-001-S-RED', name: 'Small / Red', attributes: { size: 'S', color: 'Red' } },
      { sku: 'RET-001-M-RED', name: 'Medium / Red', attributes: { size: 'M', color: 'Red' } },
      { sku: 'RET-001-L-RED', name: 'Large / Red', attributes: { size: 'L', color: 'Red' } },
      { sku: 'RET-001-S-BLUE', name: 'Small / Blue', attributes: { size: 'S', color: 'Blue' } },
    ]) {
      await prisma.productVariant.upsert({
        where: { productId_sku: { productId: tshirtId, sku: variant.sku } },
        update: { name: variant.name },
        create: {
          productId: tshirtId,
          sku: variant.sku,
          name: variant.name,
          attributes: variant.attributes,
          price: D(499),
        },
      });
    }
  }

  // Bundle -----------------------------------------------------------------
  const comboSku = 'GRO-001';
  const comboProductId = products.get(comboSku);
  if (comboProductId) {
    const bundle = await prisma.productBundle.upsert({
      where: { organizationId_productId: { organizationId, productId: comboProductId } },
      update: { name: 'Snack Combo' },
      create: { organizationId, productId: comboProductId, name: 'Snack Combo' },
    });
    await prisma.productBundleItem.deleteMany({ where: { bundleId: bundle.id } });
    await prisma.productBundleItem.createMany({
      data: [
        { bundleId: bundle.id, componentProductId: products.get('GRO-002')!, quantity: D(1) },
        { bundleId: bundle.id, componentProductId: products.get('GRO-003')!, quantity: D(2) },
      ],
      skipDuplicates: true,
    });
  }

  // Opening stock (ledger backed) ------------------------------------------
  const openingStock: {
    sku: string;
    warehouse: string;
    quantity: number;
    cost: number;
    trackBatches?: boolean;
  }[] = [
    ...featuredSpecs.map((spec) => ({
      sku: spec.sku,
      warehouse: 'JAI-MAIN',
      quantity: spec.type === 'PACKAGING_MATERIAL' ? 500 : 25,
      cost: spec.purchasePrice,
      trackBatches: spec.trackBatches,
    })),
    ...featuredSpecs.slice(0, 6).map((spec) => ({
      sku: spec.sku,
      warehouse: 'JAI-STORE',
      quantity: 10,
      cost: spec.purchasePrice,
      trackBatches: spec.trackBatches,
    })),
    ...retailSpecs.map((spec) => ({
      sku: spec.sku,
      warehouse: 'JAI-MAIN',
      quantity: 60,
      cost: spec.purchasePrice,
      trackBatches: spec.trackBatches,
    })),
    ...grocerySpecs.map((spec) => ({
      sku: spec.sku,
      warehouse: 'JAI-MAIN',
      quantity: 200,
      cost: spec.purchasePrice,
      trackBatches: spec.trackBatches,
    })),
    ...grocerySpecs.slice(0, 25).map((spec) => ({
      sku: spec.sku,
      warehouse: 'DEL-MAIN',
      quantity: 120,
      cost: spec.purchasePrice,
      trackBatches: spec.trackBatches,
    })),
  ];

  for (const line of openingStock) {
    const productId = products.get(line.sku);
    const warehouseId = warehouses.get(line.warehouse);
    if (!productId || !warehouseId) continue;

    const existing = await prisma.inventoryLedger.findFirst({
      where: { organizationId, productId, warehouseId, referenceType: 'SEED_OPENING_STOCK' },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.$transaction(async (tx) => {
      await receiveStock(tx, {
        organizationId,
        productId,
        warehouseId,
        transactionType: 'ADJUSTMENT_IN',
        quantityChange: D(line.quantity),
        unitCost: D(line.cost),
        referenceType: 'SEED_OPENING_STOCK',
        performedBy: adminId,
        notes: 'Opening stock created by seed',
        ...(line.trackBatches
          ? {
              batch: {
                batchNumber: `OPEN-${line.warehouse}`,
                manufacturingDate: new Date(),
                expiryDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
              },
            }
          : {}),
      });
    });
  }

  console.log('Seed complete');
  console.log(`Organization: ${organization.name} (${ORG_SLUG})`);
  console.log(`Full-access admin: admin@demo.test / ${DEFAULT_PASSWORD}`);
  console.log(`Super admin: superadmin@demo.test / ${DEFAULT_PASSWORD}`);
  console.log(
    `Products: ${products.size}, warehouses: ${warehouses.size}, suppliers: ${suppliers.size}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
