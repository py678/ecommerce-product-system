import { ROLE_PERMISSIONS } from './permissions.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { UserResponseDto } from './dto/auth-response.dto.js';

export const PUBLIC_USER_SELECT = {
  id: true,
  username: true,
  email: true,
  role: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

// Never spread a database user into an API response.
export function publicUser(
  user: Omit<UserResponseDto, 'permissions'>,
): UserResponseDto {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    permissions: [...ROLE_PERMISSIONS[user.role]],
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
