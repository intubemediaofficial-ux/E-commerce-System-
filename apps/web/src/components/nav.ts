export interface NavItem {
  href: string;
  label: string;
  permission?: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAVIGATION: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { href: '/dashboard', label: 'Admin dashboard', permission: 'report.view' },
      { href: '/dashboard/inventory', label: 'Inventory dashboard', permission: 'inventory.view' },
      { href: '/dashboard/restaurant', label: 'Restaurant dashboard', permission: 'report.view' },
      { href: '/dashboard/ecommerce', label: 'E-commerce dashboard', permission: 'report.view' },
    ],
  },
  {
    title: 'Catalogue',
    items: [
      { href: '/products', label: 'Products', permission: 'product.view' },
      { href: '/products/scan', label: 'Scan lookup', permission: 'product.view' },
      { href: '/categories', label: 'Categories', permission: 'product.view' },
      { href: '/brands', label: 'Brands', permission: 'product.view' },
      { href: '/units', label: 'Units', permission: 'product.view' },
    ],
  },
  {
    title: 'Inventory',
    items: [
      { href: '/inventory', label: 'Stock on hand', permission: 'inventory.view' },
      { href: '/inventory/ledger', label: 'Stock ledger', permission: 'inventory.view' },
      { href: '/inventory/batches', label: 'Batches & expiry', permission: 'inventory.view' },
      { href: '/inventory/adjustments', label: 'Adjustments', permission: 'inventory.view' },
      { href: '/inventory/transfers', label: 'Transfers', permission: 'inventory.view' },
      { href: '/inventory/wastage', label: 'Wastage', permission: 'inventory.view' },
      { href: '/inventory/import', label: 'Opening stock import', permission: 'inventory.adjust' },
    ],
  },
  {
    title: 'Purchasing',
    items: [
      { href: '/suppliers', label: 'Suppliers', permission: 'supplier.view' },
      { href: '/purchase-orders', label: 'Purchase orders', permission: 'purchase.view' },
      { href: '/goods-receipts', label: 'Goods receipts', permission: 'purchase.view' },
      { href: '/purchase-returns', label: 'Purchase returns', permission: 'purchase.view' },
    ],
  },
  {
    title: 'Restaurant',
    items: [
      { href: '/recipes', label: 'Recipes', permission: 'recipe.view' },
      { href: '/restaurant/orders', label: 'Kitchen orders', permission: 'restaurant.order.view' },
      { href: '/restaurant/consumption', label: 'Consumption', permission: 'restaurant.order.view' },
      { href: '/restaurant/food-cost', label: 'Food cost', permission: 'report.view' },
    ],
  },
  {
    title: 'E-commerce',
    items: [
      { href: '/ecommerce/orders', label: 'Orders', permission: 'ecommerce.order.view' },
      { href: '/ecommerce/reservations', label: 'Reservations', permission: 'ecommerce.order.view' },
      { href: '/ecommerce/bundles', label: 'Product bundles', permission: 'product.view' },
    ],
  },
  {
    title: 'Insights',
    items: [{ href: '/reports', label: 'Reports & exports', permission: 'report.view' }],
  },
  {
    title: 'Administration',
    items: [
      { href: '/admin/users', label: 'Users', permission: 'user.manage' },
      { href: '/admin/roles', label: 'Roles & permissions', permission: 'role.manage' },
      { href: '/admin/locations', label: 'Locations', permission: 'inventory.view' },
      { href: '/admin/warehouses', label: 'Warehouses', permission: 'inventory.view' },
      { href: '/admin/settings', label: 'Organization settings', permission: 'settings.manage' },
      { href: '/admin/audit-logs', label: 'Audit logs', permission: 'audit.view' },
      { href: '/notifications', label: 'Notifications' },
    ],
  },
];
