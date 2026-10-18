import { db } from 'sdk';
import { eq } from 'sdk/db';
import { users, activityLogs } from 'schema';

export async function findUser(tgId) {
  return await db.select().from(users).where(eq(users.tgId, Number(tgId))).get();
}

export async function upsertUser(from) {
  if (!from?.id) throw new Error('Telegram user identity is missing');

  const tgId = Number(from.id);
  const existing = await findUser(tgId);
  const now = new Date();

  if (existing) {
    await db.update(users).set({
      firstName: from.first_name || 'User',
      lastName: from.last_name || null,
      username: from.username || null,
      languageCode: from.language_code || null,
      updatedAt: now,
    }).where(eq(users.tgId, tgId)).run();
    return await findUser(tgId);
  }

  await db.insert(users).values({
    tgId,
    firstName: from.first_name || 'User',
    lastName: from.last_name || null,
    username: from.username || null,
    languageCode: from.language_code || null,
    updatedAt: now,
  }).run();

  return await findUser(tgId);
}

export async function logActivity(userTgId, action, details = '') {
  await db.insert(activityLogs).values({
    userTgId: userTgId == null ? null : Number(userTgId),
    action: String(action).slice(0, 100),
    details: String(details || '').slice(0, 2000),
  }).run();
}
