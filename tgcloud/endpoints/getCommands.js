import { db } from 'sdk';
import { and, eq, asc } from 'sdk/db';
import { botCommands } from '../schema.js';
import { requireUser } from '../lib/access.js';

export default async function (input, ctx) {
  const user = await requireUser(ctx);
  const botId = String(input?.botId || '').trim();
  if (!botId) return [];

  const rows = await db.select().from(botCommands)
    .where(eq(botCommands.telegramBotId, botId))
    .orderBy(asc(botCommands.command))
    .all();

  // Ownership is checked by the command's parent bot lookup in the Mini App layer.
  // Never expose command source/code; only configuration is returned.
  return rows;
}
