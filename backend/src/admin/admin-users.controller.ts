import {
  Body,
  Delete,
  Post,
  HttpCode,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../auth/permissions.guard.js';
import { RequirePermissions } from '../auth/permissions.js';
import { UserResponseDto } from '../auth/dto/auth-response.dto.js';
import { AdminUsersService } from './admin-users.service.js';
import {
  AdminUserPageDto,
  AdminUserQueryDto,
  AssignRoleDto,
  AccountReasonDto,
  PurgeAccountDto,
  AccountDependenciesDto,
  AccountActionDto,
} from './dto/admin-user.dto.js';
import { AccountLifecycleService } from './account-lifecycle.service.js';
@ApiTags('账号管理')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: '未登录或凭证失效' })
@ApiForbiddenResponse({
  description: '缺少对应权限或超出可管理角色范围；硬删除仅限系统管理员',
})
@ApiBadRequestResponse({
  description: '参数无效、额外字段、自改角色或角色未变化',
})
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly lifecycle: AccountLifecycleService,
  ) {}
  @Get(':id/dependencies')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('user:purge')
  @ApiOperation({ summary: '彻底删除预检：商品及所有状态订单的关联数' })
  @ApiOkResponse({ type: AccountDependenciesDto })
  @ApiNotFoundResponse({ description: '账号不存在' })
  dependencies(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.lifecycle.dependencies(req.user, id);
  }
  @Delete(':id')
  @RequirePermissions('user:delete')
  @ApiOperation({ summary: '软删除账号并撤销全部会话；保留业务数据' })
  @ApiOkResponse({ type: AccountActionDto })
  @ApiConflictResponse({ description: '重复删除或最后有效管理员' })
  @ApiNotFoundResponse({ description: '账号不存在' })
  remove(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AccountReasonDto,
  ) {
    return this.lifecycle.change(req.user, id, 'DELETE', dto);
  }
  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermissions('user:restore')
  @ApiOperation({ summary: '恢复软删除账号；保留原角色，需重新登录' })
  @ApiOkResponse({ type: AccountActionDto })
  @ApiConflictResponse({ description: '账号不在回收站' })
  @ApiNotFoundResponse({ description: '账号不存在' })
  restore(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AccountReasonDto,
  ) {
    return this.lifecycle.change(req.user, id, 'RESTORE', dto);
  }
  @Delete(':id/purge')
  @RequirePermissions('user:purge')
  @ApiOperation({
    summary:
      '系统管理员彻底删除无商品、无订单的回收站账号；保留审计与永久UUID墓碑',
  })
  @ApiOkResponse({ type: AccountActionDto })
  @ApiConflictResponse({ description: '未软删除或仍有业务关联' })
  @ApiNotFoundResponse({ description: '账号不存在' })
  purge(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PurgeAccountDto,
  ) {
    return this.lifecycle.change(req.user, id, 'PURGE', dto);
  }
  @Get()
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('user:read')
  @ApiOperation({ summary: '管理员分页搜索账号并按角色筛选' })
  @ApiOkResponse({ type: AdminUserPageDto })
  list(@Query() query: AdminUserQueryDto) {
    return this.users.list(query);
  }
  @Patch(':id/role')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('user:assign-role')
  @ApiOperation({ summary: '调整他人角色并使其所有旧会话失效；事务内记录审计' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiNotFoundResponse({ description: '账号不存在' })
  @ApiConflictResponse({ description: '不能降级最后一个管理员' })
  assign(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignRoleDto,
  ) {
    return this.users.assignRole(req.user, id, dto);
  }
}
