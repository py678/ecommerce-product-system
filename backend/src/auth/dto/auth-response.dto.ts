import { ApiProperty } from '@nestjs/swagger';
import { PERMISSIONS, type Permission } from '../permissions.js';

export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  username: string;

  @ApiProperty({ description: '有效角色编码，含自定义角色' })
  role: string;

  @ApiProperty({ format: 'uuid' })
  roleId: string;

  @ApiProperty({ description: '角色显示名称' })
  roleName: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string', enum: ['OWN', 'ALL'] },
    description: '各权限点的数据范围',
  })
  dataScopes: Partial<Record<Permission, 'OWN' | 'ALL'>>;

  @ApiProperty({ enum: PERMISSIONS, isArray: true })
  permissions: Permission[];

  @ApiProperty({ format: 'email' })
  email: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}

export class AuthResponseDto {
  @ApiProperty({
    description: 'JWT access token; use in Authorization: Bearer <token>',
  })
  accessToken: string;

  @ApiProperty({ enum: ['Bearer'] })
  tokenType: 'Bearer';

  @ApiProperty({ example: 3600, description: 'Lifetime in seconds' })
  expiresIn: number;

  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;
}
