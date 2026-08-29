import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { sessions, users } from '../db/schema.js';
import { generateToken, hashToken } from './tokens.js';
import type { UserRow } from './magicLink.js';

export const SESSION_COOKIE = 'monitoring_session';

export async function createSession(
  db: Database,
  userId: string,
  options: { ttlDays: number; userAgent?: string | null },
): Promise<string> {
  const { token, hash } = generateToken();
  await db.insert(sessions).values({
    userId,
    tokenHash: hash,
    expiresAt: new Date(Date.now() + options.ttlDays * 86_400_000),
    userAgent: options.userAgent?.slice(0, 300) ?? null,
  });
  return token;
}

export async function resolveSession(db: Database, token: string): Promise<UserRow | null> {
  const hash = hashToken(token);
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, hash))
    .limit(1);

  if (!row) return null;
  if (row.session.expiresAt.getTime() <= Date.now()) {
    await destroySession(db, token);
    return null;
  }
  if (!row.user.isActive) return null;

  // Отметка активности нужна, чтобы в будущем чистить давно брошенные сессии.
  await db
    .update(sessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(sessions.id, row.session.id));

  return row.user;
}

export async function destroySession(db: Database, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}
