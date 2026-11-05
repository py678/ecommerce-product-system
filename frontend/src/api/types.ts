export type UserRole = 'OPERATOR' | 'ADMIN';
export type Permission =
  | 'order:read'
  | 'order:create'
  | 'order:confirm'
  | 'order:ship'
  | 'order:complete'
  | 'order:cancel'
  | 'product:read'
  | 'product:create'
  | 'product:update'
  | 'product:delete'
  | 'category:read'
  | 'category:create'
  | 'category:update'
  | 'category:delete'
  | 'upload:image'
  | 'user:read'
  | 'user:assign-role';
export interface AdminUserQuery {
  page: number;
  pageSize: number;
  search?: string;
  role?: UserRole;
}
export interface User {
  id: string;
  username: string;
  role: UserRole;
  permissions: Permission[];
  email: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: User;
}

export interface Category {
  id: string;
  name: string;
  productCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  coverImage: string | null;
  price: string;
  stock: number;
  stockVersion: number;
  categoryId: string;
  userId: string;
  category: { id: string; name: string };
  user: { id: string; username: string };
  createdAt: string;
  updatedAt: string;
}

export interface ProductInput {
  name: string;
  description: string;
  coverImage?: string;
  price: string;
  stock: number;
  stockVersion?: number;
  categoryId: string;
}

export interface ImageUploadResponse {
  code: 0;
  message: 'ok';
  data: { url: string };
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ListQuery {
  page: number;
  pageSize: number;
  search?: string;
  categoryId?: string;
}

export interface ProductListQuery {
  page: number;
  pageSize: number;
  name?: string;
  /** @deprecated Use name. */
  search?: string;
  categoryId?: string;
  minPrice?: string;
  maxPrice?: string;
  stockStatus?: 'zero' | 'low' | 'normal';
  sortBy: 'price' | 'stock' | 'createdAt' | 'updatedAt';
  sortOrder: 'asc' | 'desc';
}

export interface ProductPage {
  list: Product[];
  /** @deprecated Use list. */
  items: Product[];
  total: number;
  page: number;
  pageSize: number;
  /** @deprecated Compute from total and pageSize. */
  totalPages: number;
  lowStockThreshold: number;
}
