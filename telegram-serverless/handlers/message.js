import { api, db } from 'sdk';
import { messageEvents, ownedBots } from 'schema';
import { eq, desc } from 'sdk/db';
import { upsertUser, logActivity } from 'lib/users';

function launchKeyboard() {
  // This URL is intentionally configured after the Mini App UI is hosted with HTTPS.
  // Replace this placeholder in BotFather/web_app configuration before enabling it.
  return {
    inline_keyboard: [
      [{ text: 'Open MyFa Host', callback_data: 'open_app_help' }],
      [{ text: 'Help', callback_data: 'help' }],
    ],
  };
}

export default async function (message, ctx) {
  const chatId = message?.chat?.id;
  const from = message?.from;
  if (!chatId || !from?.id) return;

  const text = typeof message.text === 'string' ? message.text.trim() : '';
  try {
    const user = await upsertUser(from);
    const updateId = ctx?.update?.update_id;

    // Ignore duplicate update IDs when available. Use the unique index as the guard.
    if (Number.isSafeInteger(updateId)) {
      const existing = await db.select().from(messageEvents).where(eq(messageEvents.updateId, updateId)).get();
      if (existing) return;
      await db.insert(messageEvents).values({
        updateId,
        chatId: Number(chatId),
        userTgId: Number(from.id),
        text: text || null,
      }).run();
    } else {
      await db.insert(messageEvents).values({
        chatId: Number(chatId),
        userTgId: Number(from.id),
        text: text || null,
      }).run();
    }

    await logActivity(from.id, 'bot_message', text);

    if (text === '/start' || text.startsWith('/start ')) {
      await api.sendMessage({
        chat_id: chatId,
        text:
          'Welcome to MyFa Host, ' + (user.firstName || 'User') + '.\n\n' +
          'This is the Telegram Serverless migration track. Your account is saved in Telegram’s database.\n\n' +
          '/help — commands\n/status — account status\n/stats — platform counters',
        reply_markup: launchKeyboard(),
      });
      return;
    }

    if (text === '/help') {
      await api.sendMessage({
        chat_id: chatId,
        text: 'MyFa Host commands\n/start — start and register\n/help — help\n/status — account status\n/stats — basic counts',
      });
      return;
    }

    if (text === '/status') {
      const bots = await db.select().from(ownedBots).where(eq(ownedBots.ownerTgId, Number(from.id))).all();
      await api.sendMessage({
        chat_id: chatId,
        text: 'Account: active\nRegistered bots: ' + bots.length + '\nBackend: Telegram Serverless DB',
      });
      return;
    }

    if (text === '/stats') {
      const userCount = await db.$count((await import('schema')).users);
      const botCount = await db.$count(ownedBots);
      await api.sendMessage({
        chat_id: chatId,
        text: 'MyFa Host stats\nUsers: ' + userCount + '\nRegistered bots: ' + botCount,
      });
      return;
    }

    if (text) {
      await api.sendMessage({
        chat_id: chatId,
        text: 'Message received and stored. Send /help to see available commands.',
      });
    }
  } catch (error) {
    console.error('message handler failed', error);
    await api.sendMessage({
      chat_id: chatId,
      text: 'A temporary error occurred. Please try again later.',
    }).catch((sendError) => console.error('failed to send error reply', sendError));
  }
}
