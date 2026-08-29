import crypto from 'node:crypto';

/**
 * В базе лежит только SHA-256 от токена: утечка дампа не даёт войти в систему.
 * Токен достаточно длинный, поэтому обычного хеша хватает — перебор невозможен.
 */
export function generateToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
