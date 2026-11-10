import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { DatabaseService } from '../database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PUBLIC_USER_SELECT, publicUser } from './public-user.js';
import { readAuthConfig } from './auth.config.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { AuthResponseDto, UserResponseDto } from './dto/auth-response.dto.js';

@Injectable()
export class AuthService {
  // Unknown accounts still incur a BCrypt comparison; do not return an existence-specific error.
  private readonly dummyHash = hash('not-a-real-account-password', 12);
  private readonly expiresIn = readAuthConfig().expiresInSeconds;

  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    await this.requirePrimary();
    const role = dto.role ?? 'OPERATOR';
    if (role === 'ADMIN') {
      const expected = process.env.ADMIN_REGISTRATION_COMPANY_ID;
      if (!expected)
        throw new ServiceUnavailableException(
          '管理员注册暂不可用，请联系维护人员',
        );
      const digest = (value: string) =>
        createHash('sha256').update(value).digest();
      if (
        !dto.companyId ||
        !timingSafeEqual(digest(dto.companyId), digest(expected))
      )
        throw new BadRequestException('公司内部 ID 不正确');
    }
    const passwordHash = await hash(dto.password, 12);
    try {
      const user = await this.db.user.create({
        data: {
          username: dto.username,
          email: dto.email,
          passwordHash,
          role,
        },
        select: { ...PUBLIC_USER_SELECT, tokenVersion: true },
      });
      return this.issueToken(publicUser(user), user.tokenVersion);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('用户名或邮箱已被使用');
      }
      throw error;
    }
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    await this.requirePrimary();
    const user = await this.db.user.findUnique({
      where: { username: dto.username },
      include: { roleDefinition: { include: { grants: true } } },
    });
    const passwordMatches = await compare(
      dto.password,
      user?.passwordHash ?? (await this.dummyHash),
    );
    if (!user || user.deletedAt || !passwordMatches)
      throw new UnauthorizedException('用户名或密码错误');
    if (!user.roleDefinition.enabled)
      throw new UnauthorizedException('账号角色已停用，请联系管理员');
    // An entrance choice never changes the database role or the granted permissions.
    if (dto.loginRole !== undefined && dto.loginRole !== user.role)
      throw new UnauthorizedException(
        '账号角色与所选登录入口不匹配，请选择正确入口',
      );
    // Explicitly construct the response so password hashes never reach the client.
    const profile = publicUser(user);
    return this.issueToken(profile, user.tokenVersion);
  }

  async findAuthenticatedUser(
    id: string,
    tokenVersion: number,
  ): Promise<UserResponseDto> {
    const user = await this.db.user.findUnique({
      where: { id },
      select: { ...PUBLIC_USER_SELECT, tokenVersion: true },
    });
    if (!user || user.deletedAt)
      throw new UnauthorizedException({
        message: '账号已停用，请联系管理员',
        code: 'SESSION_REVOKED',
      });
    const authority = await this.db.commerceConfig.findUnique({
      where: { id: 1 },
    });
    if (authority?.writeRole === 'REPLICA')
      throw new ServiceUnavailableException('请使用主服务登录和访问业务接口');
    if (!user.roleDefinition.enabled)
      throw new UnauthorizedException({
        message: '账号角色已停用，请重新登录',
        code: 'SESSION_REVOKED',
      });
    // 如需优化可加 tokenVersion 缓存，改密时失效。
    if (user.tokenVersion !== tokenVersion)
      throw new UnauthorizedException({
        message: '账号安全信息已变更，请重新登录',
        code: 'SESSION_REVOKED',
      });
    return publicUser(user);
  }

  private async requirePrimary() {
    const config = await this.db.commerceConfig.findUnique({
      where: { id: 1 },
    });
    if (config?.writeRole === 'REPLICA')
      throw new ServiceUnavailableException('请使用主服务登录和访问业务接口');
  }
  private async issueToken(
    user: UserResponseDto,
    tokenVersion: number,
  ): Promise<AuthResponseDto> {
    return {
      accessToken: await this.jwt.signAsync({ sub: user.id, tokenVersion }),
      tokenType: 'Bearer',
      expiresIn: this.expiresIn,
      user,
    };
  }
}
