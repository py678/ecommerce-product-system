import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';
import type { Prisma, UserRole } from '../generated/prisma/client.js';
export const PERMISSIONS = [
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
] as const;
export type Permission = (typeof PERMISSIONS)[number];
export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  VIEWER: ['product:read', 'category:read'],
  OPERATOR: [
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
  role: UserRole;
}
// This scope is also attached to the actual write, never just a preliminary read.
export function productScope(actor: Actor): Prisma.ProductWhereInput {
  return actor.role === 'ADMIN' ? {} : { userId: actor.id };
}
