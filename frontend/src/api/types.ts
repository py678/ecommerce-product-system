export type UserRole = 'OPERATOR' | 'ADMIN';
export type Permission =
  | 'stock:read'
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
  | 'user:assign-role'
  | 'user:delete'
  | 'user:restore'
  | 'user:purge'
  | 'role:read'
  | 'role:create'
  | 'role:update'
  | 'role:delete';
export interface AdminUserQuery {
  status?: 'active' | 'deleted';
  page: number;
  pageSize: number;
  search?: string;
  role?: string;
  roleId?: string;
}
export interface AdminUser extends User {
  deletedAt: string | null;
  deletedBy: string | null;
  deleteReason: string | null;
}
export interface AccountDependencies {
  productCount: number;
  orderCount: number;
  canPurge: boolean;
}
export interface User {
  id: string;
  username: string;
  role: string;
  roleId: string;
  roleName: string;
  dataScopes: Partial<Record<Permission, DataScope>>;
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
  stockReason?: string;
  name: string;
  description: string;
  coverImage?: string;
  price: string;
  stock: number;
  stockVersion?: number;
  categoryId: string;
}

export type StockMovementType =
  'BASELINE' | 'INITIAL' | 'ADJUSTMENT' | 'ORDER_DEDUCT' | 'ORDER_CANCEL';
export interface StockMovement {
  id: string;
  productId: string;
  productName: string;
  type: StockMovementType;
  beforeStock: number;
  quantityChange: number;
  afterStock: number;
  stockVersion: number;
  actorId: string | null;
  actorName: string | null;
  orderId: string | null;
  orderNo: string | null;
  canViewOrder: boolean;
  reason: string;
  createdAt: string;
}
export interface StockMovementQuery {
  page: number;
  pageSize: number;
  type?: StockMovementType;
  createdFrom?: string;
  createdTo?: string;
  orderNo?: string;
  productId?: string;
  name?: string;
}
export interface StockMovementPage {
  list: StockMovement[];
  total: number;
  page: number;
  pageSize: number;
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

export type DataScope = 'OWN' | 'ALL';
export interface RoleGrant {
  permission: Permission;
  scope: DataScope;
}
export interface RoleOption {
  id: string;
  code: string;
  name: string;
}
export interface Role extends RoleOption {
  description: string;
  enabled: boolean;
  system: boolean;
  version: number;
  userCount: number;
  grants: RoleGrant[];
  createdAt: string;
  updatedAt: string;
}
export interface PermissionDefinition {
  code: Permission;
  name: string;
  module: string;
  scoped: boolean;
}
export interface RoleInput {
  code: string;
  name: string;
  description: string;
  grants: RoleGrant[];
}
export interface RolePage {
  items: Role[];
  total: number;
  page: number;
  pageSize: number;
}
export interface RoleAudit {
  id: string;
  actorId: string;
  roleId: string;
  action: string;
  before: unknown;
  after: unknown;
  createdAt: string;
}
export interface AuditPage {
  items: RoleAudit[];
  total: number;
  page: number;
  pageSize: number;
}
