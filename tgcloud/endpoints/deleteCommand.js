import { db } from 'sdk';
import { and, eq } from 'sdk/db';
import { botCommands } from '../schema.js';
import { requireUser } from '../lib/access.js';
import { requireOwnedBot } from '../lib/bots.js';

export default async function (input, ctx) {
  const user = await requireUser(ctx);
  const botId = String(input?.botId || '').trim();
  const commandId = Number(input?.commandId);
  if (!botId || !Number.isInteger(commandId)) throw new Error('botId and commandId are required');

  await requireOwnedBot(botId, user.tgId);

  await db.delete(botCommands)
    .where(and(eq(botCommands.id, commandId), eq(botCommands.telegramBotId, botId)))
    .run();

  return { success: true };
}
