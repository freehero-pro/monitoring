import { and, count, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { loginTokens, users } from '../db/schema.js';
import { generateToken, hashToken } from './tokens.js';

export type UserRow = typeof users.$inferSelect;

export type IssueResult =
  | { status: 'issued'; token: string; user: UserRow }
  | { status: 'unknown_user' }
  | { status: 'rate_limited' };

export type ConsumeResult =
  | { status: 'ok'; user: UserRow }
  | { status: 'invalid' }
  | { status: 'expired' }
  | { status: 'used' }
  | { status: 'inactive' };

/** Больше пяти ссылок в час на один адрес — почти наверняка перебор или ошибка клиента. */
const MAX_LINKS_PER_HOUR = 5;

export async function issueMagicLink(
  db: Database,
  email: string,
  options: { ttlMinutes: number; ip?: string | null },
): Promise<IssueResult> {
  const user = await findActiveUser(db, email);
  if (!user) return { status: 'unknown_user' };

  const [recent] = await db
    .select({ value: count() })
    .from(loginTokens)
    .where(
      and(
        eq(loginTokens.userId, user.id),
        gt(loginTokens.createdAt, new Date(Date.now() - 3_600_000)),
      ),
    );
  if ((recent?.value ?? 0) >= MAX_LINKS_PER_HOUR) return { status: 'rate_limited' };

  const { token, hash } = generateToken();
  await db.insert(loginTokens).values({
    userId: user.id,
    tokenHash: hash,
    expiresAt: new Date(Date.now() + options.ttlMinutes * 60_000),
    requestedIp: options.ip ?? null,
  });

  return { status: 'issued', token, user };
}

/**
 * Погашает токен: одна ссылка — один вход. Пометка `used_at` ставится условно
 * (`WHERE used_at IS NULL`), поэтому два параллельных перехода не создадут две сессии.
 */
export async function consumeMagicLink(db: Database, token: string): Promise<ConsumeResult> {
  const hash = hashToken(token);
  const [record] = await db.select().from(loginTokens).where(eq(loginTokens.tokenHash, hash));

  if (!record) return { status: 'invalid' };
  if (record.usedAt) return { status: 'used' };
  if (record.expiresAt.getTime() <= Date.now()) return { status: 'expired' };

  const claimed = await db
    .update(loginTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(loginTokens.id, record.id), isNull(loginTokens.usedAt)))
    .returning({ id: loginTokens.id });
  if (claimed.length === 0) return { status: 'used' };

  const [user] = await db.select().from(users).where(eq(users.id, record.userId));
  if (!user || !user.isActive) return { status: 'inactive' };

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  return { status: 'ok', user };
}

export async function findActiveUser(db: Database, email: string): Promise<UserRow | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email}) AND ${users.isActive}`)
    .limit(1);
  return user ?? null;
}
