import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard.js';
import { UserResponseDto } from '../auth/dto/auth-response.dto.js';
import {
  ChangePasswordDto,
  PasswordChangedDto,
  UpdateProfileDto,
} from './dto/user.dto.js';
import { UsersService } from './users.service.js';

@ApiTags('个人中心')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: '登录凭证缺失、无效、过期或已失效' })
@ApiBadRequestResponse({
  description: '字段校验失败；不接受任何查询参数或 userId',
})
@UseGuards(JwtAuthGuard)
@Controller('users/me')
export class UsersController {
  constructor(private readonly users: UsersService) {}
  private rejectQuery(query: Record<string, unknown>) {
    if (Object.keys(query).length)
      throw new BadRequestException('此接口不接受查询参数');
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '查看当前用户资料；身份仅来自 JWT' })
  @ApiOkResponse({ type: UserResponseDto })
  me(
    @Req() req: AuthenticatedRequest,
    @Query() query: Record<string, unknown>,
  ) {
    this.rejectQuery(query);
    return req.user;
  }

  @Patch()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '修改当前用户邮箱；其余字段禁止写入' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiConflictResponse({ description: '邮箱已被使用，包含并发唯一冲突' })
  update(
    @Req() req: AuthenticatedRequest,
    @Query() query: Record<string, unknown>,
    @Body() dto: UpdateProfileDto,
  ) {
    this.rejectQuery(query);
    return this.users.updateProfile(req.user.id, dto);
  }

  @Patch('password')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary: '修改密码并使所有旧凭证失效；不签发新凭证，每分钟每 IP 最多 5 次',
  })
  @ApiOkResponse({ type: PasswordChangedDto })
  @ApiTooManyRequestsResponse({ description: '请求过于频繁，请稍后重试' })
  password(
    @Req() req: AuthenticatedRequest,
    @Query() query: Record<string, unknown>,
    @Body() dto: ChangePasswordDto,
  ) {
    this.rejectQuery(query);
    return this.users.changePassword(req.user.id, dto);
  }
}
