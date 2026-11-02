import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { UploadService } from './upload.service.js';
import { MAX_IMAGE_BYTES } from './upload.config.js';
import { UploadResponseDto } from './dto/upload-response.dto.js';

@ApiTags('upload')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('upload')
export class UploadController {
  constructor(private readonly uploads: UploadService) {}

  @Post('image')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0 },
    }),
  )
  @ApiOperation({ summary: '上传商品图片（JPG/JPEG/PNG/WEBP，最多 5MB）' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ type: UploadResponseDto })
  @ApiUnauthorizedResponse({ description: '缺少或无效的 JWT' })
  @ApiBadRequestResponse({ description: '缺少文件、格式错误或文件字段不合法' })
  @ApiResponse({ status: 413, description: '文件超过 5MB' })
  async image(
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<UploadResponseDto> {
    return {
      code: 0,
      message: 'ok',
      data: { url: await this.uploads.saveImage(file) },
    };
  }
}
