import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { isUUID } from 'class-validator';
import { AuthService } from './auth.service.js';
@Injectable()
export class AccessTokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly auth: AuthService,
  ) {}
  checkUser(id: string, tokenVersion: number) {
    return this.auth.findAuthenticatedUser(id, tokenVersion);
  }
  async verify(token: string) {
    let subject: string;
    let tokenVersion: number;
    let expiresAt: number;
    try {
      const payload =
        await this.jwt.verifyAsync<Record<string, unknown>>(token);
      if (
        typeof payload !== 'object' ||
        !payload ||
        typeof payload.sub !== 'string' ||
        !isUUID(payload.sub) ||
        typeof payload.exp !== 'number' ||
        typeof payload.tokenVersion !== 'number' ||
        !Number.isSafeInteger(payload.tokenVersion) ||
        payload.tokenVersion < 0 ||
        payload.tokenVersion > 2147483647
      ) {
        throw new Error('Invalid access token claims');
      }
      expiresAt = payload.exp * 1000;
      subject = payload.sub;
      tokenVersion = payload.tokenVersion as number;
    } catch {
      throw new UnauthorizedException('登录令牌无效或已过期');
    }
    const user = await this.auth.findAuthenticatedUser(subject, tokenVersion);
    return { user, expiresAt, tokenVersion };
  }
}
