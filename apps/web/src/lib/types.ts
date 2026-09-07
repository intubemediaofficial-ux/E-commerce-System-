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

export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: Status;
  lastLoginAt: string | null;
  createdAt: string;
  userRoles: { role: { id: string; slug: string; name: string } }[];
}

export interface ManagedRole {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isSystem: boolean;
  userCount: number;
}

export interface Product {
  id: string;
  name: string;
  imageUrl: string | null;
  purchasePrice: string;
  warehouseName: string | null;
  stockDate: string | null;
  currentStock: string;
  status: Status;
  createdAt: string;
  updatedAt: string;
}
