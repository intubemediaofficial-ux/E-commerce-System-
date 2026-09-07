export interface NavItem {
  href: string;
  label: string;
  permission?: string;
}

export const NAVIGATION: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', permission: 'product.view' },
  { href: '/products', label: 'Products', permission: 'product.view' },
  { href: '/products/new', label: 'Add Product', permission: 'product.create' },
];
