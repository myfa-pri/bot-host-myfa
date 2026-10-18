import { api, db } from 'sdk';
import { ownedBots, botLogs } from '../schema.js';
import { eq } from 'sdk/db';

// Records Telegram managed-bot lifecycle updates for MyFa Host.
// This does not execute arbitrary user code and never stores a bot token.
export default async function (update, ctx) {
  const bot = update?.bot || update?.managed_bot || update;
  const botId = bot?.id ?? bot?.bot_id ?? update?.bot_id;
  const ownerId = update?.user?.id ?? update?.owner_user_id ?? update?.user_id;
  const username = bot?.username || update?.username || null;
  const displayName = bot?.first_name || bot?.name || username || ('Bot ' + String(botId || ''));

  if (!botId) {
    console.log('managed_bot update received without bot id');
    return;
  }

  const telegramBotId = String(botId);

  const existing = await db.select()
    .from(ownedBots)
    .where(eq(ownedBots.telegramBotId, telegramBotId))
    .limit(1)
    .all();

  if (existing.length) {
    await db.update(ownedBots)
      .set({
        username,
        displayName,
        status: 'managed',
        metadata: { updateType: 'managed_bot', raw: update },
      })
      .where(eq(ownedBots.telegramBotId, telegramBotId))
      .run();
  } else if (ownerId) {
    await db.insert(ownedBots).values({
      telegramBotId,
      ownerTgId: Number(ownerId),
      username,
      displayName,
      status: 'managed',
      metadata: { updateType: 'managed_bot', raw: update },
    }).run();
  }

  await db.insert(botLogs).values({
    telegramBotId,
    level: 'info',
    message: 'Managed bot created or updated by Telegram.',
  }).run();

  if (ownerId) {
    await api.sendMessage({
      chat_id: Number(ownerId),
      text:
        'Managed bot connected to MyFa Host.\n\n' +
        'Bot: ' + displayName + '\n' +
        'ID: ' + telegramBotId + '\n\n' +
        'The bot configuration can now be managed from MyFa Host.',
    });
  }
}
