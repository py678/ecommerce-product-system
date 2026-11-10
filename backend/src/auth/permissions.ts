import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';
import type { Prisma, UserRole } from '../generated/prisma/client.js';
export const PERMISSIONS = [
  'order:read',
  'order:create',
  'order:confirm',
  'order:ship',
  'order:complete',
  'order:cancel',
  'product:read',
  'product:create',
  'product:update',
  'product:delete',
  'category:read',
  'category:create',
  'category:update',
  'category:delete',
  'upload:image',
  'user:read',
  'user:assign-role',
  'user:delete',
  'user:restore',
  'user:purge',
  'role:read',
  'role:create',
  'role:update',
  'role:delete',
] as const;
export type Permission = (typeof PERMISSIONS)[number];
// Compatibility fixtures and initial-role documentation only; live authorization reads roleDefinition.grants.
export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  OPERATOR: [
    'order:read',
    'order:create',
    'order:confirm',
    'order:ship',
    'order:complete',
    'order:cancel',
    'product:read',
    'product:create',
    'product:update',
    'product:delete',
    'category:read',
    'upload:image',
  ],
  ADMIN: PERMISSIONS,
};
export const PERMISSION_KEY = 'required-permissions';
export const RequirePermissions = (...permissions: Permission[]) =>
  applyDecorators(
    SetMetadata(PERMISSION_KEY, permissions),
    ApiExtension('x-permissions', permissions),
  );
export interface Actor {
  id: string;
  role: string;
  roleId?: string;
  permissions?: Permission[];
  dataScopes?: Partial<Record<Permission, 'OWN' | 'ALL'>>;
}
export function hasAllScope(actor: Actor, permission: Permission): boolean {
  return (
    actor.permissions?.includes(permission) === true &&
    actor.dataScopes?.[permission] === 'ALL'
  );
}
// Absence of a verified scope fails closed, including callers using a role name alone.
export function productScope(
  actor: Actor,
  permission: Permission = 'product:update',
): Prisma.ProductWhereInput {
  return hasAllScope(actor, permission) ? {} : { userId: actor.id };
}
