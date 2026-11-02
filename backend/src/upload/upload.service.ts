import { BadRequestException, Injectable } from '@nestjs/common';
import type {} from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import {
  IMAGE_EXTENSIONS,
  MAX_IMAGE_BYTES,
  UPLOAD_DIRECTORY,
} from './upload.config.js';

@Injectable()
export class UploadService {
  async saveImage(file?: Express.Multer.File): Promise<string> {
    if (!file?.buffer?.length) throw new BadRequestException('请选择图片文件');
    const extension = extname(file.originalname).toLowerCase();
    const mime =
      extension === '.jpg' || extension === '.jpeg'
        ? 'image/jpeg'
        : `image/${extension.slice(1)}`;
    const bytes = file.buffer;
    // Validate both the declared type and signature before writing anything to disk.
    const signature =
      mime === 'image/jpeg'
        ? bytes.length >= 3 &&
          bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
        : mime === 'image/png'
          ? bytes
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : mime === 'image/webp' &&
            bytes.length >= 12 &&
            bytes.toString('ascii', 0, 4) === 'RIFF' &&
            bytes.toString('ascii', 8, 12) === 'WEBP';
    if (
      !IMAGE_EXTENSIONS.has(extension) ||
      file.mimetype !== mime ||
      !signature
    )
      throw new BadRequestException(
        '仅支持内容与扩展名一致的 JPG、JPEG、PNG、WEBP 图片',
      );
    if (file.size > MAX_IMAGE_BYTES)
      throw new BadRequestException('图片不能超过 5MB');
    const filename = `${randomUUID()}${extension}`;
    await mkdir(UPLOAD_DIRECTORY, { recursive: true });
    await writeFile(join(UPLOAD_DIRECTORY, filename), bytes, { flag: 'wx' });
    return `/uploads/${filename}`;
  }
}
