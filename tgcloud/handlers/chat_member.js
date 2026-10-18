import { db } from 'sdk';
import { eq } from 'sdk/db';
import { users } from '../schema.js';
import { logActivity } from '../lib/users.js';

export default async function (update) {
  const user = update?.new_chat_member?.user;
  if (!user?.id) return;

  await logActivity(user.id, 'chat_member', JSON.stringify({
    chatId: update.chat?.id,
    status: update.new_chat_member?.status,
  }).slice(0, 2000));

  const existing = await db.select().from(users).where(eq(users.tgId, Number(user.id))).get();
  if (!existing) return;
}
