import type { Permission, User, UserRole } from '../api/types';
export const ROLE_LABELS: Record<UserRole, string> = {
  OPERATOR: '运营人员',
  ADMIN: '管理员',
};
export function can(user: User | null, permission: Permission): boolean {
  return user?.permissions?.includes(permission) ?? false;
}
export function canManageProduct(
  user: User | null,
  ownerId: string,
  permission: 'product:update' | 'product:delete',
): boolean {
  return (
    can(user, permission) &&
    (user?.dataScopes?.[permission] === 'ALL' || user?.id === ownerId)
  );
}

export function roleLabel(user: User | null): string {
  return (
    user?.roleName ||
    (user?.role ? ROLE_LABELS[user.role as UserRole] || user.role : '')
  );
}
export function homePath(user: User | null): string {
  if (can(user, 'product:read')) return '/products';
  if (can(user, 'order:read')) return '/orders';
  if (can(user, 'category:read')) return '/categories';
  if (can(user, 'role:read')) return '/admin/roles';
  if (can(user, 'user:read')) return '/admin/users';
  return '/profile';
}
export function canManageOrder(
  user: User | null,
  ownerId: string,
  permission: Permission,
): boolean {
  return (
    can(user, permission) &&
    (user?.id === ownerId || user?.dataScopes?.[permission] === 'ALL')
  );
}
