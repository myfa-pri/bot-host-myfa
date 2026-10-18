import { db } from 'sdk';
import { eq } from 'sdk/db';
import { EndpointError } from 'sdk';
import { users } from '../schema.js';

export async function requireUser(ctx) {
  const user = ctx?.initData?.user;
  if (!user?.id) {
    throw new EndpointError('Telegram authorization is required', { code: 'UNAUTHORIZED' });
  }

  const row = await db.select().from(users).where(eq(users.tgId, Number(user.id))).get();
  if (!row) {
    throw new EndpointError('User account is not initialized', { code: 'USER_NOT_FOUND' });
  }

  if (row.banned) {
    throw new EndpointError('This account is blocked', { code: 'BANNED' });
  }

  return row;
}

export async function requireAdmin(ctx) {
  const user = await requireUser(ctx);
  if (!user.isAdmin) {
    throw new EndpointError('Administrator access is required', { code: 'FORBIDDEN' });
  }
  return user;
}
