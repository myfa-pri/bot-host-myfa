import { db } from 'sdk';
import { eq, asc } from 'sdk/db';
import { botCommands } from '../schema.js';
import { requireUser } from '../lib/access.js';
import { requireOwnedBot } from '../lib/bots.js';

export default async function (input, ctx) {
  const user = await requireUser(ctx);
  const botId = String(input?.botId || '').trim();
  if (!botId) return [];

  await requireOwnedBot(botId, user.tgId);

  return await db.select().from(botCommands)
    .where(eq(botCommands.telegramBotId, botId))
    .orderBy(asc(botCommands.command))
    .all();
}
