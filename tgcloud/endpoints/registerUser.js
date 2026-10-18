import { upsertUser, logActivity } from '../lib/users.js';

export default async function (input, ctx) {
  const tgUser = ctx?.initData?.user;
  if (!tgUser?.id) throw new Error('Telegram user is missing');

  const user = await upsertUser(tgUser);
  await logActivity(tgUser.id, 'miniapp_open', 'Serverless Mini App');

  return {
    success: true,
    user: {
      id: user.tgId,
      name: user.firstName,
      username: user.username,
      plan: user.plan,
      gems: user.gems,
      coins: user.coins,
    },
  };
}
