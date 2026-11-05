import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AccessTokenService } from './access-token.service.js';
import type { UserResponseDto } from './dto/auth-response.dto.js';
export interface AuthenticatedRequest extends Request {
  user: UserResponseDto;
}
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tokens: AccessTokenService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = /^Bearer\s+(\S+)$/i.exec(
      request.headers.authorization ?? '',
    )?.[1];
    if (!token) throw new UnauthorizedException('请提供 Bearer 登录令牌');
    request.user = (await this.tokens.verify(token)).user;
    return true;
  }
}
