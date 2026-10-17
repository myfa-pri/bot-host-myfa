import { api, db } from 'sdk';
import { users, ownedBots, messageEvents } from 'schema';
import { eq } from 'sdk/db';
import { upsertUser, logActivity } from 'lib/users';

function launchKeyboard() {
  // Replace with a Web App URL after the UI is hosted over HTTPS and named endpoints exist.
  return {
    inline_keyboard: [
      [{ text: 'How to open MyFa Host', callback_data: 'open_app_help' }],
      [{ text: 'Help', callback_data: 'help' }],
    ],
  };
}

export default async function (message, ctx) {
  const chatId = message?.chat?.id;
  const from = message?.from;
  if (chatId == null || !from?.id) return;

  const text = typeof message.text === 'string' ? message.text.trim() : '';
  try {
    const user = await upsertUser(from);
    const updateId = ctx?.update?.update_id;

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
          'Your account is stored in Telegram Serverless DB.\n\n' +
          '/help — commands\n/status — your account\n/stats — basic counters',
        reply_markup: launchKeyboard(),
      });
      return;
    }

    if (text === '/help') {
      await api.sendMessage({
        chat_id: chatId,
        text: 'MyFa Host commands\n/start — register and open menu\n/help — help\n/status — account status\n/stats — database counts',
      });
      return;
    }

    if (text === '/status') {
      const bots = await db.select().from(ownedBots).where(eq(ownedBots.ownerTgId, Number(from.id))).all();
      await api.sendMessage({
        chat_id: chatId,
        text: 'Account: active\nRegistered bot records: ' + bots.length + '\nBackend: Telegram Serverless DB',
      });
      return;
    }

    if (text === '/stats') {
      const userCount = await db.$count(users);
      const botCount = await db.$count(ownedBots);
      await api.sendMessage({
        chat_id: chatId,
        text: 'MyFa Host stats\nUsers: ' + userCount + '\nRegistered bot records: ' + botCount,
      });
      return;
    }

    if (text) {
      await api.sendMessage({
        chat_id: chatId,
        text: 'Message received and stored. Send /help for available commands.',
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
