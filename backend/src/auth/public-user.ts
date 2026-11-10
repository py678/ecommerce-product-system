import type { Prisma } from '../generated/prisma/client.js';
import type { UserResponseDto } from './dto/auth-response.dto.js';
import { PERMISSIONS, type Permission } from './permissions.js';
export const PUBLIC_USER_SELECT = {
  id: true,
  username: true,
  email: true,
  role: true,
  roleId: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  roleDefinition: { include: { grants: true } },
} satisfies Prisma.UserSelect;
type UserRecord = Prisma.UserGetPayload<{ select: typeof PUBLIC_USER_SELECT }>;
// Never spread DB records or trust the legacy role column for authorization.
export function publicUser(user: UserRecord): UserResponseDto {
  const role = user.roleDefinition;
  const grants = role.enabled
    ? role.grants.filter((g) =>
        (PERMISSIONS as readonly string[]).includes(g.permissionCode),
      )
    : [];
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: role.code,
    roleId: role.id,
    roleName: role.name,
    permissions: grants.map((g) => g.permissionCode as Permission),
    dataScopes: Object.fromEntries(
      grants.map((g) => [g.permissionCode, g.scope]),
    ),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
