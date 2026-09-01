export const PERMISSIONS = {
  // master data
  'product.view': 'product',
  'product.create': 'product',
  'product.update': 'product',
  'product.delete': 'product',
  'category.manage': 'product',
  'brand.manage': 'product',
  'unit.manage': 'product',
  // inventory
  'inventory.view': 'inventory',
  'inventory.adjust': 'inventory',
  'inventory.transfer': 'inventory',
  'inventory.transfer.approve': 'inventory',
  'inventory.wastage': 'inventory',
  'inventory.batch.manage': 'inventory',
  // purchasing
  'supplier.view': 'purchase',
  'supplier.manage': 'purchase',
  'purchase.view': 'purchase',
  'purchase.create': 'purchase',
  'purchase.update': 'purchase',
  'purchase.approve': 'purchase',
  'purchase.receive': 'purchase',
  'purchase.return': 'purchase',
  // ecommerce
  'ecommerce.order.view': 'ecommerce',
  'ecommerce.order.manage': 'ecommerce',
  'ecommerce.bundle.manage': 'ecommerce',
  // platform
  'report.view': 'report',
  'dashboard.view': 'report',
  'user.manage': 'admin',
  'role.manage': 'admin',
  'organization.manage': 'admin',
  'location.manage': 'admin',
  'warehouse.manage': 'admin',
  'settings.manage': 'admin',
  'audit.view': 'admin',
  'notification.view': 'platform',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const ROLES: Record<string, { name: string; permissions: Permission[] | 'ALL' }> = {
  super_admin: { name: 'Super Admin', permissions: 'ALL' },
  admin: { name: 'Admin', permissions: 'ALL' },
  inventory_manager: {
    name: 'Inventory Manager',
    permissions: [
      'product.view',
      'inventory.view',
      'inventory.adjust',
      'inventory.transfer',
      'inventory.transfer.approve',
      'inventory.wastage',
      'inventory.batch.manage',
      'purchase.view',
      'purchase.receive',
      'warehouse.manage',
      'report.view',
      'dashboard.view',
      'notification.view',
    ],
  },
  purchase_manager: {
    name: 'Purchase Manager',
    permissions: [
      'product.view',
      'supplier.view',
      'supplier.manage',
      'purchase.view',
      'purchase.create',
      'purchase.update',
      'purchase.receive',
      'purchase.return',
      'inventory.view',
      'report.view',
      'dashboard.view',
      'notification.view',
    ],
  },
  sales_manager: {
    name: 'Sales/E-commerce Manager',
    permissions: [
      'product.view',
      'product.create',
      'product.update',
      'inventory.view',
      'ecommerce.order.view',
      'ecommerce.order.manage',
      'ecommerce.bundle.manage',
      'report.view',
      'dashboard.view',
      'notification.view',
    ],
  },
  accountant: {
    name: 'Accountant',
    permissions: [
      'product.view',
      'inventory.view',
      'purchase.view',
      'supplier.view',
      'ecommerce.order.view',
      'report.view',
      'dashboard.view',
      'notification.view',
    ],
  },
};
