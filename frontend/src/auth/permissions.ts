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
    can(user, permission) && (user?.role === 'ADMIN' || user?.id === ownerId)
  );
}
