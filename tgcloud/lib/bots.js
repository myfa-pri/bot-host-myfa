import { db } from 'sdk';
import { and, eq } from 'sdk/db';
import { ownedBots } from '../schema.js';
import { EndpointError } from 'sdk';

export async function getOwnedBot(botId, ownerTgId) {
  if (!botId) return null;
  return await db.select().from(ownedBots)
    .where(and(
      eq(ownedBots.telegramBotId, String(botId)),
      eq(ownedBots.ownerTgId, Number(ownerTgId)),
    ))
    .get();
}

export async function requireOwnedBot(botId, ownerTgId) {
  const bot = await getOwnedBot(botId, ownerTgId);
  if (!bot) {
    throw new EndpointError('Bot not found or access denied', { code: 'BOT_FORBIDDEN' });
  }
  return bot;
}
