import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { PaginationDto } from '../../common/dto/pagination.dto.js';
import { PERMISSIONS, type Permission } from '../../auth/permissions.js';
const optional = (_o: unknown, v: unknown) => v !== undefined;
export class RoleGrantDto {
  @ApiProperty({ enum: PERMISSIONS })
  @IsEnum(Object.fromEntries(PERMISSIONS.map((p) => [p, p])))
  permission: Permission;
  @ApiProperty({
    enum: ['OWN', 'ALL'],
    description: '商品/订单按操作配置归属范围；其他权限固定 ALL',
  })
  @IsEnum({ OWN: 'OWN', ALL: 'ALL' })
  scope: 'OWN' | 'ALL';
}
export class CreateRoleDto {
  @ApiProperty({ example: 'CATALOG_EDITOR', minLength: 2, maxLength: 32 })
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,31}$/)
  code: string;
  @ApiProperty({ maxLength: 80 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 80)
  name: string;
  @ApiPropertyOptional({ maxLength: 500 })
  @ValidateIf(optional)
  @IsString()
  @MaxLength(500)
  description?: string;
  @ApiProperty({
    type: [RoleGrantDto],
    description: '最多21项，权限不可重复；无权限角色仅可使用个人中心',
  })
  @IsArray()
  @ArrayMaxSize(21)
  @ArrayUnique((g: RoleGrantDto) => g.permission)
  @ValidateNested({ each: true })
  @Type(() => RoleGrantDto)
  grants: RoleGrantDto[];
}
export class UpdateRoleDto extends PartialType(CreateRoleDto, {
  skipNullProperties: false,
}) {
  @ApiProperty({ minimum: 0, description: '当前角色版本；并发修改返回409' })
  @IsInt()
  @Min(0)
  @Max(2147483647)
  version: number;
  @ApiPropertyOptional() @ValidateIf(optional) @IsBoolean() enabled?: boolean;
}
export class RoleQueryDto extends PaginationDto {}
export class RoleResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty() description: string;
  @ApiProperty() enabled: boolean;
  @ApiProperty() system: boolean;
  @ApiProperty() version: number;
  @ApiProperty() userCount: number;
  @ApiProperty({ type: [RoleGrantDto] }) grants: RoleGrantDto[];
  @ApiProperty({ format: 'date-time', type: String }) createdAt: Date;
  @ApiProperty({ format: 'date-time', type: String }) updatedAt: Date;
}
export class RolePageDto {
  @ApiProperty({ type: [RoleResponseDto] }) items: RoleResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() pageSize: number;
}
export class PermissionResponseDto {
  @ApiProperty({ enum: PERMISSIONS }) code: Permission;
  @ApiProperty() name: string;
  @ApiProperty() module: string;
  @ApiProperty() scoped: boolean;
}

export class PermissionAuditDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) actorId: string;
  @ApiProperty({ format: 'uuid' }) roleId: string;
  @ApiProperty({ enum: ['CREATE', 'UPDATE', 'DELETE', 'ASSIGN_USER'] })
  action: string;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  before: Record<string, unknown> | null;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  after: Record<string, unknown> | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
}
export class PermissionAuditPageDto {
  @ApiProperty({ type: [PermissionAuditDto] }) items: PermissionAuditDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() pageSize: number;
}
