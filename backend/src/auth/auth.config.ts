import 'dotenv/config';

export const JWT_ISSUER = 'silk-shop-api';
export const JWT_AUDIENCE = 'silk-shop-admin';

export function readAuthConfig() {
  const secret = process.env.JWT_SECRET;
  if (
    !secret ||
    Buffer.byteLength(secret, 'utf8') < 32 ||
    /CHANGE_ME|REPLACE_WITH/i.test(secret)
  ) {
    throw new Error(
      'Configure JWT_SECRET with at least 32 random bytes in backend/.env.',
    );
  }
  const lifetime = process.env.JWT_EXPIRES_IN_SECONDS ?? '3600';
  const expiresInSeconds = Number(lifetime);
  if (
    !/^\d+$/.test(lifetime) ||
    !Number.isSafeInteger(expiresInSeconds) ||
    expiresInSeconds < 60 ||
    expiresInSeconds > 86400
  ) {
    throw new Error(
      'JWT_EXPIRES_IN_SECONDS must be an integer between 60 and 86400.',
    );
  }
  return { secret, expiresInSeconds };
}
