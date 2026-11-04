import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
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
    const passwordHash = await hash(dto.password, 12);
    try {
      const user = await this.db.user.create({
        data: {
          username: dto.username,
          email: dto.email,
          passwordHash,
          role: 'VIEWER',
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
    const user = await this.db.user.findUnique({
      where: { username: dto.username },
    });
    const passwordMatches = await compare(
      dto.password,
      user?.passwordHash ?? (await this.dummyHash),
    );
    if (!user || !passwordMatches)
      throw new UnauthorizedException('用户名或密码错误');
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
    if (!user) throw new UnauthorizedException('登录状态无效，请重新登录');
    // 如需优化可加 tokenVersion 缓存，改密时失效。
    if (user.tokenVersion !== tokenVersion)
      throw new UnauthorizedException({
        message: '账号安全信息已变更，请重新登录',
        code: 'SESSION_REVOKED',
      });
    return publicUser(user);
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
