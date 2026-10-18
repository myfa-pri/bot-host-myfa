import { db } from 'sdk';
import { eq } from 'sdk/db';
import { ownedBots, botCommands } from 'schema';

export default async function (input, ctx) {
  const tgUser = ctx?.initData?.user;
  const commandId = Number(input?.id);

  if (!tgUser?.id) throw new Error('Telegram authorization is required');
  if (!Number.isInteger(commandId) || commandId < 1) throw new Error('Valid command id is required');

  const command = await db.select().from(botCommands).where(eq(botCommands.id, commandId)).get();
  if (!command) throw new Error('Command not found');

  const bot = await db.select().from(ownedBots).where(eq(ownedBots.telegramBotId, command.telegramBotId)).get();
  if (!bot || Number(bot.ownerTgId) !== Number(tgUser.id)) throw new Error('Bot not found or access denied');

  await db.delete(botCommands).where(eq(botCommands.id, commandId)).run();
  return { deleted: true, id: commandId };
}
