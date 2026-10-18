import { db } from 'sdk';
import { eq, desc } from 'sdk/db';
import { ownedBots } from '../schema.js';
import { requireUser } from '../lib/access.js';

export default async function (input, ctx) {
  const user = await requireUser(ctx);
  const rows = await db.select().from(ownedBots)
    .where(eq(ownedBots.ownerTgId, Number(user.tgId)))
    .orderBy(desc(ownedBots.updatedAt))
    .all();

  return rows.map((bot) => ({
    id: bot.telegramBotId,
    username: bot.username,
    displayName: bot.displayName,
    status: bot.status,
    createdAt: bot.createdAt,
    updatedAt: bot.updatedAt,
    metadata: bot.metadata,
  }));
}
