import { db } from 'sdk';
import { users, ownedBots } from 'schema';
import { and, eq } from 'sdk/db';

export async function requireAdmin(tgId) {
  const user = await db.select().from(users).where(eq(users.tgId, Number(tgId))).get();
  if (!user || !user.isAdmin || user.banned) {
    throw new Error('Forbidden: administrator access required');
  }
  return user;
}

export async function requireBotAccess(tgId, telegramBotId) {
  const user = await db.select().from(users).where(eq(users.tgId, Number(tgId))).get();
  if (!user || user.banned) throw new Error('Forbidden: account unavailable');

  const bot = await db.select().from(ownedBots).where(and(
    eq(ownedBots.telegramBotId, String(telegramBotId)),
    eq(ownedBots.ownerTgId, Number(tgId)),
  )).get();

  if (!bot && !user.isAdmin) throw new Error('Forbidden: you do not own this bot');
  if (!bot && user.isAdmin) {
    return await db.select().from(ownedBots).where(eq(ownedBots.telegramBotId, String(telegramBotId))).get();
  }
  return bot;
}
