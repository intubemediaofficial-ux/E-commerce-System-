export type Status = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

export interface AuthUser {
  id: string;
  organizationId: string;
  organizationName: string;
  name: string;
  email: string;
  roles: string[];
  permissions: string[];
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export interface Unit {
  id: string;
  code: string;
  name: string;
  dimension: string;
}

export interface Warehouse {
  id: string;
  name: string;
  code: string;
  type: string;
  status: Status;
  locationId: string | null;
}

export interface Location {
  id: string;
  name: string;
  code: string;
  city?: string | null;
  status: Status;
}

export interface Category {
  id: string;
  name: string;
  parentCategoryId: string | null;
  status: Status;
  children?: Category[];
}

export interface Brand {
  id: string;
  name: string;
  status: Status;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  productType: string;
  purchasePrice: string;
  sellingPrice: string;
  taxRate: string;
  reorderLevel: string;
  minimumStockLevel: string;
  maximumStockLevel: string | null;
  trackBatches: boolean;
  isPerishable: boolean;
  status: Status;
  unit?: Unit;
  category?: { id: string; name: string } | null;
  brand?: { id: string; name: string } | null;
  stock?: {
    warehouseId: string;
    quantity: string;
    reservedQuantity: string;
    warehouse?: { id: string; name: string; code: string };
  }[];
}

export interface Supplier {
  id: string;
  name: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  paymentTerms: string | null;
  creditLimit: string;
  status: Status;
}

export interface StockRow {
  id: string;
  productId: string;
  warehouseId: string;
  quantity: string;
  reservedQuantity: string;
  availableQuantity: string;
  damagedQuantity: string;
  averageCost: string;
  stockValue: string;
  stockStatus: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
  product: {
    id: string;
    name: string;
    sku: string;
    reorderLevel: string;
    isPerishable: boolean;
    unit?: { code: string };
  };
  warehouse: { id: string; name: string; type: string };
  variant?: { id: string; name: string; sku: string } | null;
}

export interface LedgerRow {
  id: string;
  createdAt: string;
  transactionType: string;
  referenceType: string | null;
  quantityBefore: string;
  quantityChange: string;
  quantityAfter: string;
  unitCost: string;
  totalCost: string;
  product: { name: string; sku: string };
  warehouse: { name: string; code: string };
  performer?: { name: string } | null;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  status: string;
  orderDate: string;
  expectedDate: string | null;
  grandTotal: string;
  supplier: { id: string; name: string };
  warehouse: { id: string; name: string; code: string };
  items?: PurchaseOrderItem[];
}

export interface PurchaseOrderItem {
  id: string;
  productId: string;
  quantity: string;
  receivedQuantity: string;
  unitCost: string;
  total: string;
  product?: { name: string; sku: string };
}

export interface Recipe {
  id: string;
  name: string;
  yieldQuantity: string;
  status: Status;
  product: { id: string; name: string; sku: string; sellingPrice: string };
  items: {
    id: string;
    ingredientProductId: string;
    quantity: string;
    wastagePercentage: string;
    ingredientProduct?: { name: string; sku: string };
  }[];
}

export interface RestaurantOrder {
  id: string;
  orderNumber: string;
  status: string;
  tableNumber: string | null;
  grandTotal: string;
  createdAt: string;
  warehouse: { name: string; code: string };
  items?: { id: string; productId: string; quantity: string; unitPrice: string; product?: { name: string } }[];
}

export interface EcommerceOrder {
  id: string;
  orderNumber: string;
  status: string;
  customerName: string | null;
  grandTotal: string;
  createdAt: string;
  warehouse: { id: string; name: string; code: string };
  items?: { id: string; productId: string; quantity: string; unitPrice: string; product?: { name: string; sku: string } }[];
}

export interface Reservation {
  id: string;
  orderId: string;
  quantity: string;
  status: string;
  expiresAt: string | null;
  product: { name: string; sku: string };
  warehouse: { name: string; code: string };
}

export interface Transfer {
  id: string;
  transferNumber: string;
  status: string;
  createdAt: string;
  sourceWarehouse: { id: string; name: string; code: string };
  destinationWarehouse: { id: string; name: string; code: string };
  items?: { id: string; productId: string; quantity: string; product?: { name: string; sku: string } }[];
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  readAt: string | null;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  action: string;
  module: string;
  entityType: string | null;
  entityId: string | null;
  ipAddress: string | null;
  createdAt: string;
  user?: { name: string; email: string } | null;
}

export interface Role {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isSystem: boolean;
  permissions?: { permission: { id: string; slug: string } }[];
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  lastLoginAt: string | null;
  roles: { role: { id: string; name: string; slug: string } }[];
}

export interface ReportPayload {
  title: string;
  columns: { header: string; key: string }[];
  rows: Record<string, string | number | null>[];
  meta?: Record<string, unknown>;
}
