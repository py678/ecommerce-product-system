import {
  RealtimeService,
  notifySessionChange,
} from '../realtime/realtime.service.js';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { DatabaseService } from '../database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PUBLIC_USER_SELECT, publicUser } from '../auth/public-user.js';
import type { UserResponseDto } from '../auth/dto/auth-response.dto.js';
import type { ChangePasswordDto, UpdateProfileDto } from './dto/user.dto.js';

export const PASSWORD_CHANGED_MESSAGE = '密码已修改，请重新登录';

@Injectable()
export class UsersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly realtime: RealtimeService,
  ) {}

  async updateProfile(
    id: string,
    dto: UpdateProfileDto,
  ): Promise<UserResponseDto> {
    try {
      return publicUser(
        await this.db.user.update({
          where: { id },
          data: { email: dto.email },
          select: PUBLIC_USER_SELECT,
        }),
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') throw new ConflictException('邮箱已被使用');
        if (error.code === 'P2025')
          throw new UnauthorizedException('登录状态无效，请重新登录');
      }
      throw error;
    }
  }

  async changePassword(
    id: string,
    dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    const user = await this.db.user.findUnique({
      where: { id },
      select: { passwordHash: true, tokenVersion: true },
    });
    if (!user) throw new UnauthorizedException('登录状态无效，请重新登录');
    if (!(await compare(dto.oldPassword, user.passwordHash)))
      throw new BadRequestException('原密码错误');
    if (
      dto.newPassword === dto.oldPassword ||
      (await compare(dto.newPassword, user.passwordHash))
    )
      throw new BadRequestException('新密码不得与原密码相同');
    // Hash outside the transaction; the conditional write rejects concurrent password changes.
    const passwordHash = await hash(dto.newPassword, 12);
    await this.db.$transaction(async (tx) => {
      const result = await tx.user.updateMany({
        where: {
          id,
          passwordHash: user.passwordHash,
          tokenVersion: user.tokenVersion,
        },
        data: { passwordHash, tokenVersion: { increment: 1 } },
      });
      if (result.count !== 1)
        throw new UnauthorizedException(PASSWORD_CHANGED_MESSAGE);
    });
    notifySessionChange(this.realtime, id, 'passwordChanged');
    return { message: PASSWORD_CHANGED_MESSAGE };
  }
}
