import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsUUID, Length, ValidateIf } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto.js';
import { UserResponseDto } from '../../auth/dto/auth-response.dto.js';
const optional = (_o: unknown, v: unknown) => v !== undefined;
export class AdminUserQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: '角色编码；兼容旧筛选参数' })
  @ValidateIf(optional)
  @IsString()
  @Length(2, 32)
  role?: string;
  @ApiPropertyOptional({ format: 'uuid', description: '按角色ID筛选' })
  @ValidateIf(optional)
  @IsUUID()
  roleId?: string;
}
export class AssignRoleDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: '目标角色；与 role 二选一，推荐使用此字段',
  })
  @ValidateIf(optional)
  @IsUUID()
  roleId?: string;
  @ApiPropertyOptional({
    deprecated: true,
    description: '兼容旧客户端的角色编码；与 roleId 二选一',
  })
  @ValidateIf(optional)
  @IsString()
  @Length(2, 32)
  role?: string;
}
export class AdminUserPageDto {
  @ApiProperty({ type: [UserResponseDto] }) items: UserResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() pageSize: number;
  @ApiProperty() totalPages: number;
}
