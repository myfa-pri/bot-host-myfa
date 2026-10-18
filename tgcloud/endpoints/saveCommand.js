import { db } from 'sdk';
import { and, eq } from 'sdk/db';
import { botCommands } from '../schema.js';
import { requireUser } from '../lib/access.js';
import { requireOwnedBot } from '../lib/bots.js';

function cleanCommand(value) {
  return String(value || '').trim().replace(/^\//, '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32);
}

export default async function (input, ctx) {
  const user = await requireUser(ctx);
  const botId = String(input?.botId || '').trim();
  const command = cleanCommand(input?.command);
  if (!botId || !command) throw new Error('botId and command are required');

  await requireOwnedBot(botId, user.tgId);

  const answer = String(input?.answer || '').slice(0, 4000);
  const help = String(input?.help || '').slice(0, 200);
  const aliases = String(input?.aliases || '').slice(0, 500);
  const existing = await db.select().from(botCommands)
    .where(and(eq(botCommands.telegramBotId, botId), eq(botCommands.command, command)))
    .get();

  if (existing) {
    await db.update(botCommands).set({ answer, help, aliases, updatedAt: new Date() })
      .where(eq(botCommands.id, existing.id)).run();
  } else {
    await db.insert(botCommands).values({
      telegramBotId: botId,
      command,
      answer,
      help,
      aliases,
      updatedAt: new Date(),
    }).run();
  }

  return { success: true, command };
}
