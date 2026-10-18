import { db } from 'sdk';
import { and, eq } from 'sdk/db';
import { ownedBots, botCommands } from 'schema';

export default async function (input, ctx) {
  const tgUser = ctx?.initData?.user;
  const botId = String(input?.telegramBotId || '');
  const command = String(input?.command || '').trim().toLowerCase().replace(/^\//, '');
  const help = input?.help == null ? null : String(input.help).slice(0, 500);
  const answer = input?.answer == null ? null : String(input.answer).slice(0, 4000);

  if (!tgUser?.id) throw new Error('Telegram authorization is required');
  if (!botId || !command) throw new Error('telegramBotId and command are required');
  if (!/^[a-z0-9_]{1,32}$/.test(command)) throw new Error('Invalid command name');

  const bot = await db.select().from(ownedBots).where(eq(ownedBots.telegramBotId, botId)).get();
  if (!bot || Number(bot.ownerTgId) !== Number(tgUser.id)) throw new Error('Bot not found or access denied');

  const existing = await db.select().from(botCommands)
    .where(and(eq(botCommands.telegramBotId, botId), eq(botCommands.command, command))).get();

  if (existing) {
    await db.update(botCommands).set({ help, answer, updatedAt: new Date() }).where(eq(botCommands.id, existing.id)).run();
    return await db.select().from(botCommands).where(eq(botCommands.id, existing.id)).get();
  }

  const [created] = await db.insert(botCommands).values({
    telegramBotId: botId,
    command,
    help,
    answer,
  }).returning().run();

  return created;
}
