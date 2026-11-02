import { ApiProperty } from '@nestjs/swagger';

class UploadedImageDto {
  @ApiProperty({ example: '/uploads/96c01d96-53f3-4fb8-b761-923ab8fae3fe.png' })
  url: string;
}

export class UploadResponseDto {
  @ApiProperty({ example: 0 })
  code: number;

  @ApiProperty({ example: 'ok' })
  message: string;

  @ApiProperty({ type: UploadedImageDto })
  data: UploadedImageDto;
}
