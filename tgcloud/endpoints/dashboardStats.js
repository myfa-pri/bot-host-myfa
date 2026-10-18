import { db } from 'sdk';
import { eq } from 'sdk/db';
import { users, ownedBots, botCommands, messageEvents } from '../schema.js';
import { requireUser } from '../lib/access.js';

export default async function (input, ctx) {
  const user = await requireUser(ctx);
  const userId = Number(user.tgId);
  const bots = await db.$count(ownedBots, eq(ownedBots.ownerTgId, userId));

  let commands = 0;
  const owned = await db.select().from(ownedBots).where(eq(ownedBots.ownerTgId, userId)).all();
  for (const bot of owned) {
    commands += await db.$count(botCommands, eq(botCommands.telegramBotId, bot.telegramBotId));
  }

  const messages = await db.$count(messageEvents, eq(messageEvents.userTgId, userId));

  return {
    users: await db.$count(users),
    bots,
    commands,
    messages,
    gems: user.gems,
    coins: user.coins,
    level: user.level,
    xp: user.xp,
  };
}
