import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { isUUID } from 'class-validator';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import type { UserResponseDto } from './dto/auth-response.dto.js';

export interface AuthenticatedRequest extends Request {
  user: UserResponseDto;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = /^Bearer\s+(\S+)$/i.exec(
      request.headers.authorization ?? '',
    )?.[1];
    if (!token) throw new UnauthorizedException('请提供 Bearer 登录令牌');
    let subject: string;
    try {
      const payload =
        await this.jwt.verifyAsync<Record<string, unknown>>(token);
      if (
        typeof payload !== 'object' ||
        !payload ||
        typeof payload.sub !== 'string' ||
        !isUUID(payload.sub) ||
        typeof payload.exp !== 'number'
      ) {
        throw new Error('Invalid access token claims');
      }
      subject = payload.sub;
    } catch {
      throw new UnauthorizedException('登录令牌无效或已过期');
    }
    request.user = await this.auth.findAuthenticatedUser(subject);
    return true;
  }
}
