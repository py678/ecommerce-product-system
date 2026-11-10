import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsUUID,
  Length,
  ValidateIf,
  IsIn,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationDto } from '../../common/dto/pagination.dto.js';
import { UserResponseDto } from '../../auth/dto/auth-response.dto.js';
const optional = (_o: unknown, v: unknown) => v !== undefined;
export class AdminUserQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: ['active', 'deleted'],
    default: 'active',
    description: '正常账号或回收站；列表与统计同时应用',
  })
  @ValidateIf(optional)
  @IsIn(['active', 'deleted'])
  status?: 'active' | 'deleted';
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
export class AccountReasonDto {
  @ApiProperty({
    minLength: 1,
    maxLength: 500,
    example: '离职账号停用',
    description: '操作原因；不得填写密码或令牌',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 500)
  @Matches(/\S/)
  reason: string;
}
export class PurgeAccountDto extends AccountReasonDto {
  @ApiProperty({
    minLength: 3,
    maxLength: 64,
    description: '必须精确输入目标用户名',
  })
  @IsString()
  @Length(3, 64)
  username: string;
}
export class AdminUserDto extends UserResponseDto {
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  deletedAt: Date | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) deletedBy:
    string | null;
  @ApiProperty({ type: String, nullable: true }) deleteReason: string | null;
}
export class AccountDependenciesDto {
  @ApiProperty() productCount: number;
  @ApiProperty({ description: '包含全部订单状态' }) orderCount: number;
  @ApiProperty({ description: '仅为预检，实际提交仍会事务内复查' })
  canPurge: boolean;
}
export class AccountActionDto {
  @ApiProperty() message: string;
}
export class AdminUserPageDto {
  @ApiProperty({ type: [AdminUserDto] }) items: AdminUserDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() pageSize: number;
  @ApiProperty() totalPages: number;
}
