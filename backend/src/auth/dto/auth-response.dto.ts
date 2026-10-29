import { ApiProperty } from '@nestjs/swagger';

export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  username: string;

  @ApiProperty({ format: 'email' })
  email: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;
}

export class AuthResponseDto {
  @ApiProperty({
    description: 'JWT access token; use in Authorization: Bearer <token>',
  })
  accessToken: string;

  @ApiProperty({ enum: ['Bearer'] })
  tokenType: 'Bearer';

  @ApiProperty({ example: 3600, description: 'Lifetime in seconds' })
  expiresIn: number;

  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;
}
