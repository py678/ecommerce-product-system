import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { UserRole } from '../../generated/prisma/client.js';
import { PaginationDto } from '../../common/dto/pagination.dto.js';
import { UserResponseDto } from '../../auth/dto/auth-response.dto.js';
export class AdminUserQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: UserRole,
    description: '按角色筛选；search 搜索用户名或邮箱',
  })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
export class AssignRoleDto {
  @ApiProperty({ enum: UserRole, description: '目标角色；禁止其他字段' })
  @IsEnum(UserRole)
  role: UserRole;
}
export class AdminUserPageDto {
  @ApiProperty({ type: [UserResponseDto] }) items: UserResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() pageSize: number;
  @ApiProperty() totalPages: number;
}
