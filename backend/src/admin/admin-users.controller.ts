import {
  Body,
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
} from './dto/admin-user.dto.js';
@ApiTags('账号管理')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: '未登录或凭证失效' })
@ApiForbiddenResponse({ description: '仅管理员可访问' })
@ApiBadRequestResponse({
  description: '参数无效、额外字段、自改角色或角色未变化',
})
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}
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
