import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { RequirePermissions } from '../auth/permissions.js';
import { RolesService } from './roles.service.js';
import {
  PermissionAuditPageDto,
  CreateRoleDto,
  PermissionResponseDto,
  RolePageDto,
  RoleQueryDto,
  RoleResponseDto,
  UpdateRoleDto,
} from './dto/role.dto.js';
@ApiTags('角色管理')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiUnauthorizedResponse({ description: '登录凭证无效或角色停用' })
@ApiForbiddenResponse({ description: '缺少权限或试图授予超出自身权限' })
@ApiBadRequestResponse({
  description: '字段无效、敏感字段、权限依赖不完整或系统角色保护',
})
@ApiConflictResponse({ description: '编码重复、版本冲突或角色仍有用户' })
@ApiNotFoundResponse({ description: '角色不存在' })
@ApiServiceUnavailableResponse({ description: '只读副本禁止权限配置' })
@Controller('admin/roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}
  @Get('permissions')
  @RequirePermissions('role:read')
  @ApiOperation({ summary: '固定权限点目录' })
  @ApiOkResponse({ type: [PermissionResponseDto] })
  catalog() {
    return this.roles.catalog();
  }
  @Get('options')
  @RequirePermissions('user:read')
  @ApiOperation({ summary: '账号筛选与分配使用的启用角色选项' })
  @ApiOkResponse({
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          code: { type: 'string' },
          name: { type: 'string' },
        },
      },
    },
  })
  options() {
    return this.roles.options();
  }
  @Get()
  @RequirePermissions('role:read')
  @ApiOkResponse({ type: RolePageDto })
  @ApiOperation({ summary: '分页查询角色、权限及关联用户数量' })
  list(@Query() q: RoleQueryDto) {
    return this.roles.list(q);
  }
  @Post()
  @RequirePermissions('role:create')
  @ApiCreatedResponse({ type: RoleResponseDto })
  @ApiOperation({ summary: '创建角色并分配白名单权限与范围' })
  create(@Req() r: AuthenticatedRequest, @Body() d: CreateRoleDto) {
    return this.roles.create(r.user, d);
  }
  @Get(':id/audits')
  @ApiOkResponse({ type: PermissionAuditPageDto })
  @RequirePermissions('role:read')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '分页查询角色配置审计，删除后仍可查' })
  audits(@Param('id', ParseUUIDPipe) id: string, @Query() q: RoleQueryDto) {
    return this.roles.audits(id, q);
  }
  @Get(':id')
  @RequirePermissions('role:read')
  @ApiOkResponse({ type: RoleResponseDto })
  @ApiOperation({ summary: '角色详情' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.roles.get(id);
  }
  @Patch(':id')
  @RequirePermissions('role:update')
  @ApiOkResponse({ type: RoleResponseDto })
  @ApiOperation({ summary: '修改角色，撤销所有关联用户旧凭证并记录审计' })
  update(
    @Req() r: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: UpdateRoleDto,
  ) {
    return this.roles.update(r.user, id, d);
  }
  @Delete(':id')
  @RequirePermissions('role:delete')
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiOperation({ summary: '删除无用户的自定义角色，保留审计' })
  remove(
    @Req() r: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.roles.remove(r.user, id);
  }
}
