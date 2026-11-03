import { Transform } from 'class-transformer';
import {
  IsByteLength,
  IsEmail,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiProperty({
    format: 'email',
    maxLength: 254,
    example: 'profile@example.com',
    description: '唯一邮箱；去除首尾空白并转小写',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @IsEmail()
  @MaxLength(254)
  email: string;
}

export class ChangePasswordDto {
  @ApiProperty({
    format: 'password',
    writeOnly: true,
    minLength: 8,
    maxLength: 72,
    description: '原密码，不 trim；沿用登录规则，最多 72 UTF-8 字节',
  })
  @IsString()
  @Length(8, 72)
  @IsByteLength(8, 72)
  @Matches(/\S/)
  oldPassword: string;

  @ApiProperty({
    format: 'password',
    writeOnly: true,
    minLength: 8,
    maxLength: 32,
    description:
      '8–32 字符，至少包含一个英文字母和一个数字；最多 72 UTF-8 字节，不 trim；不得与原密码相同',
  })
  @IsString()
  @Length(8, 32)
  @IsByteLength(8, 72)
  @Matches(/^(?=[\s\S]*[A-Za-z])(?=[\s\S]*[0-9])[\s\S]+$/, {
    message: 'newPassword must contain an English letter and a digit',
  })
  newPassword: string;
}

export class PasswordChangedDto {
  @ApiProperty({ example: '密码已修改，请重新登录' })
  message: string;
}
