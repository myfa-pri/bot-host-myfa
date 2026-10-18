import { db } from 'sdk';
import { eq } from 'sdk/db';
import { ownedBots, botCommands } from 'schema';

export default async function (input, ctx) {
  const tgUser = ctx?.initData?.user;
  const botId = String(input?.telegramBotId || '');
  if (!tgUser?.id) throw new Error('Telegram authorization is required');
  if (!botId) throw new Error('telegramBotId is required');

  const bot = await db.select().from(ownedBots)
    .where(eq(ownedBots.telegramBotId, botId)).get();
  if (!bot || Number(bot.ownerTgId) !== Number(tgUser.id)) throw new Error('Bot not found or access denied');

  return await db.select().from(botCommands)
    .where(eq(botCommands.telegramBotId, botId))
    .orderBy(botCommands.id)
    .all();
}
