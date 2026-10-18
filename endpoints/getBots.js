import { db } from 'sdk';
import { eq } from 'sdk/db';
import { ownedBots } from 'schema';

export default async function (input, ctx) {
  const tgUser = ctx?.initData?.user;
  if (!tgUser?.id) throw new Error('Telegram authorization is required');

  return await db.select().from(ownedBots)
    .where(eq(ownedBots.ownerTgId, Number(tgUser.id)))
    .orderBy(ownedBots.id)
    .all();
}
