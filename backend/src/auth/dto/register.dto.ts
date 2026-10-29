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

export class RegisterDto {
  @ApiProperty({ example: 'silk_demo', minLength: 3, maxLength: 64 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(3, 64)
  @Matches(/^[\p{L}\p{N}_-]+$/u, {
    message:
      'username may contain letters, numbers, underscores and hyphens only',
  })
  username: string;

  @ApiProperty({ example: 'demo@example.com', maxLength: 254 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({
    minLength: 8,
    maxLength: 72,
    format: 'password',
    writeOnly: true,
    description: '8+ characters, at most 72 UTF-8 bytes; never trimmed',
  })
  @IsString()
  @Length(8, 72)
  @IsByteLength(8, 72)
  @Matches(/\S/, { message: 'password must not be blank' })
  password: string;
}
