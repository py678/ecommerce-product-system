import { isURL, registerDecorator } from 'class-validator';
import type { ValidationOptions } from 'class-validator';

export function IsCoverImageUrl(
  options?: ValidationOptions,
): PropertyDecorator {
  return (target, property) =>
    registerDecorator({
      name: 'isCoverImageUrl',
      target: target.constructor,
      propertyName: String(property),
      options,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return false;
          // Empty string explicitly clears the optional cover; upload URLs are same-origin paths.
          return (
            value === '' ||
            /^\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpe?g|png|webp)$/.test(
              value,
            ) ||
            isURL(value, {
              protocols: ['http', 'https'],
              require_protocol: true,
              require_tld: false,
            })
          );
        },
        defaultMessage: () =>
          'coverImage 必须是上传图片路径或有效的 HTTP(S) URL，空字符串可清空封面',
      },
    });
}
