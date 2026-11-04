import { IsEnum, IsOptional } from 'class-validator';
import { UserRole } from '../../generated/prisma/client.js';
import { ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { RegisterDto } from './register.dto.js';

export class LoginDto extends PickType(RegisterDto, [
  'username',
  'password',
] as const) {
  @ApiPropertyOptional({
    enum: UserRole,
    example: 'OPERATOR',
    description:
      '登录入口角色，仅核对数据库角色，不赋予或修改权限；不匹配返回 401。省略时兼容原登录接口。',
  })
  @IsOptional()
  @IsEnum(UserRole)
  loginRole?: UserRole;
}
