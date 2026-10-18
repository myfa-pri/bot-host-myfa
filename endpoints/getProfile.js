import { db } from 'sdk';
import { eq } from 'sdk/db';
import { users } from 'schema';
import { upsertUser } from 'lib/users';

export default async function (input, ctx) {
  const tgUser = ctx?.initData?.user;
  if (!tgUser?.id) throw new Error('Telegram user is missing');

  const user = await upsertUser(tgUser);
  return {
    id: user.tgId,
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
    languageCode: user.languageCode,
    plan: user.plan,
    gems: user.gems,
    coins: user.coins,
    xp: user.xp,
    level: user.level,
    banned: user.banned,
    isAdmin: user.isAdmin,
  };
}
