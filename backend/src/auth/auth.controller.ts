import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import type { AuthenticatedRequest } from './jwt-auth.guard.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { AuthResponseDto, UserResponseDto } from './dto/auth-response.dto.js';

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: '注册并获取登录令牌' })
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiBadRequestResponse({ description: '输入验证失败' })
  @ApiConflictResponse({ description: '用户名或邮箱重复' })
  @ApiTooManyRequestsResponse({ description: '请求过于频繁' })
  register(@Body() dto: RegisterDto): Promise<AuthResponseDto> {
    return this.auth.register(dto);
  }

  @Post('login')
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: '通过用户名和密码登录' })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiBadRequestResponse({ description: '输入验证失败' })
  @ApiUnauthorizedResponse({ description: '用户名或密码错误' })
  @ApiTooManyRequestsResponse({ description: '请求过于频繁' })
  login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.auth.login(dto);
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前登录用户' })
  @ApiOkResponse({ type: UserResponseDto })
  @ApiUnauthorizedResponse({ description: '令牌缺失、无效、过期或用户已删除' })
  me(@Req() request: AuthenticatedRequest): UserResponseDto {
    return request.user;
  }
}
