import { resolve } from 'node:path';

export const UPLOAD_DIRECTORY = resolve(process.cwd(), 'uploads');
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
