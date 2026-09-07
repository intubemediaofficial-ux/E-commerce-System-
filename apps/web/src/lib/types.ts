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
