import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { crudRouter, delegate } from '../../lib/crud';
import { nonNegativeDecimal } from '../../lib/query';
import categoriesRouter from './categories.routes';
import unitsRouter from './units.routes';

const statusSchema = z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional();

export const brandsRouter = crudRouter({
  entity: 'Brand',
  module: 'masterdata',
  delegate: delegate(prisma.brand),
  viewPermission: 'product.view',
  managePermission: 'brand.manage',
  sortable: ['name', 'createdAt'],
  defaultSort: 'name',
  searchFields: ['name'],
  createSchema: z.object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).optional(),
    status: statusSchema,
  }),
});

export const locationsRouter = crudRouter({
  entity: 'Location',
  module: 'admin',
  delegate: delegate(prisma.location),
  viewPermission: 'inventory.view',
  managePermission: 'location.manage',
  sortable: ['name', 'code', 'createdAt'],
  defaultSort: 'name',
  searchFields: ['name', 'code', 'city'],
  include: { _count: { select: { warehouses: true } } },
  createSchema: z.object({
    name: z.string().trim().min(1).max(120),
    code: z.string().trim().min(1).max(30),
    address: z.string().trim().max(300).optional(),
    city: z.string().trim().max(80).optional(),
    state: z.string().trim().max(80).optional(),
    country: z.string().trim().max(80).optional(),
    status: statusSchema,
  }),
});

export const warehousesRouter = crudRouter({
  entity: 'Warehouse',
  module: 'admin',
  delegate: delegate(prisma.warehouse),
  viewPermission: 'inventory.view',
  managePermission: 'warehouse.manage',
  sortable: ['name', 'code', 'type', 'createdAt'],
  defaultSort: 'name',
  searchFields: ['name', 'code'],
  filters: {
    type: z
      .enum([
        'MAIN_WAREHOUSE',
        'BRANCH_WAREHOUSE',
        'RESTAURANT_KITCHEN',
        'COLD_STORAGE',
        'PACKAGING_STORE',
        'RETAIL_STORE',
      ])
      .optional(),
    locationId: z.string().uuid().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
  },
  include: {
    location: { select: { id: true, name: true } },
    manager: { select: { id: true, name: true } },
  },
  createSchema: z.object({
    name: z.string().trim().min(1).max(120),
    code: z.string().trim().min(1).max(30),
    locationId: z.string().uuid().nullable().optional(),
    type: z
      .enum([
        'MAIN_WAREHOUSE',
        'BRANCH_WAREHOUSE',
        'RESTAURANT_KITCHEN',
        'COLD_STORAGE',
        'PACKAGING_STORE',
        'RETAIL_STORE',
      ])
      .default('MAIN_WAREHOUSE'),
    address: z.string().trim().max(300).optional(),
    managerId: z.string().uuid().nullable().optional(),
    status: statusSchema,
  }),
});

export const suppliersRouter = crudRouter({
  entity: 'Supplier',
  module: 'purchase',
  delegate: delegate(prisma.supplier),
  viewPermission: 'supplier.view',
  managePermission: 'supplier.manage',
  sortable: ['name', 'companyName', 'createdAt'],
  defaultSort: 'name',
  searchFields: ['name', 'companyName', 'email', 'phone'],
  filters: { status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional() },
  createSchema: z.object({
    name: z.string().trim().min(1).max(160),
    companyName: z.string().trim().max(160).optional(),
    phone: z.string().trim().max(30).optional(),
    email: z.string().email().optional(),
    address: z.string().trim().max(300).optional(),
    taxNumber: z.string().trim().max(60).optional(),
    paymentTerms: z.string().trim().max(120).optional(),
    creditLimit: nonNegativeDecimal.optional(),
    notes: z.string().trim().max(1000).optional(),
    status: statusSchema,
  }),
});

export { categoriesRouter, unitsRouter };

export const masterDataRouter = Router();
masterDataRouter.use('/categories', categoriesRouter);
masterDataRouter.use('/brands', brandsRouter);
masterDataRouter.use('/units', unitsRouter);
masterDataRouter.use('/locations', locationsRouter);
masterDataRouter.use('/warehouses', warehousesRouter);
masterDataRouter.use('/suppliers', suppliersRouter);
