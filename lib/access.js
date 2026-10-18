import { db } from 'sdk';
import { eq } from 'sdk/db';
import { users } from 'schema';

export async function requireUser(ctx) {
  const tgUser = ctx?.initData?.user;
  if (!tgUser?.id) throw new Error('Telegram authorization is required');

  const user = await db.select().from(users).where(eq(users.tgId, Number(tgUser.id))).get();
  if (!user) throw new Error('User account is not initialized');
  if (user.banned) throw new Error('This account is blocked');

  return user;
}

export async function requireAdmin(ctx) {
  const user = await requireUser(ctx);
  if (!user.isAdmin) throw new Error('Administrator access is required');
  return user;
}
