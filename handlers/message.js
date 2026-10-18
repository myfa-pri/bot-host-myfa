import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { messageEvents } from 'schema';
import { upsertUser, logActivity } from 'lib/users';

function menuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: 'Profile', callback_data: 'profile' },
        { text: 'Balance', callback_data: 'balance' },
      ],
      [
        { text: 'My Bots', callback_data: 'bots' },
        { text: 'Templates', callback_data: 'templates' },
      ],
      [{ text: 'Help', callback_data: 'help' }],
    ],
  };
}

export default async function (message, ctx) {
  if (!message?.chat) return;

  const chatId = message.chat.id;
  const from = message.from;
  const text = String(message.text || '').trim();
  const updateId = ctx?.update?.update_id;

  if (from?.id) {
    const user = await upsertUser(from);

    if (updateId != null) {
      await db.insert(messageEvents).values({
        updateId: Number(updateId),
        chatId: Number(chatId),
        userTgId: Number(from.id),
        text: text || null,
      }).onConflictDoUpdate({
        target: messageEvents.updateId,
        set: { text: text || null },
      }).run();
    } else {
      await db.insert(messageEvents).values({
        chatId: Number(chatId),
        userTgId: Number(from.id),
        text: text || null,
      }).run();
    }

    await logActivity(from.id, 'message', text.slice(0, 200));

    if (user.banned) {
      await api.sendMessage({ chat_id: chatId, text: 'This account is blocked.' });
      return;
    }
  }

  if (text === '/start') {
    await api.sendMessage({
      chat_id: chatId,
      text: 'MYFA HOST\n\nYour Telegram-native bot platform is ready.\n\nUse the menu below to continue.',
      reply_markup: menuKeyboard(),
    });
    return;
  }

  if (text === '/help') {
    await api.sendMessage({
      chat_id: chatId,
      text: 'MYFA HOST COMMANDS\n\n/start - Open MyFa Host\n/help - Show help\n/menu - Main menu\n/buttons - Inline buttons\n/keyboard - Reply keyboard\n/poll - Test Telegram poll\n/status - Serverless status',
    });
    return;
  }

  if (text === '/menu') {
    await api.sendMessage({ chat_id: chatId, text: 'MYFA HOST MENU', reply_markup: menuKeyboard() });
    return;
  }

  if (text === '/buttons') {
    await api.sendMessage({
      chat_id: chatId,
      text: 'Telegram inline button test',
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Profile', callback_data: 'profile' },
            { text: 'Balance', callback_data: 'balance' },
          ],
          [{ text: 'My Bots', callback_data: 'bots' }],
          [{ text: 'Open Telegram', url: 'https://telegram.org' }],
        ],
      },
    });
    return;
  }

  if (text === '/keyboard') {
    await api.sendMessage({
      chat_id: chatId,
      text: 'Reply keyboard enabled.',
      reply_markup: {
        keyboard: [
          [{ text: 'Profile' }, { text: 'Balance' }],
          [{ text: 'My Bots' }, { text: 'Settings' }],
          [{ text: 'Remove Keyboard' }],
        ],
        resize_keyboard: true,
        is_persistent: true,
      },
    });
    return;
  }

  if (text === 'Remove Keyboard') {
    await api.sendMessage({ chat_id: chatId, text: 'Reply keyboard removed.', reply_markup: { remove_keyboard: true } });
    return;
  }

  if (text === '/poll') {
    await api.sendPoll({
      chat_id: chatId,
      question: 'What should MyFa Host build next?',
      options: [
        { text: 'Bot management' },
        { text: 'Templates' },
        { text: 'Mini App tools' },
        { text: 'Analytics' },
      ],
      is_anonymous: false,
    });
    return;
  }

  if (text === '/status') {
    const count = await db.$count(messageEvents, eq(messageEvents.chatId, Number(chatId)));
    await api.sendMessage({ chat_id: chatId, text: 'MYFA HOST SERVERLESS\n\nStatus: Online\nMessages stored: ' + count });
    return;
  }

  if (text === 'Profile' || text === 'Balance' || text === 'My Bots' || text === 'Settings') {
    const callback = text === 'Profile' ? 'profile' : text === 'Balance' ? 'balance' : text === 'My Bots' ? 'bots' : 'settings';
    await api.sendMessage({ chat_id: chatId, text: text + ':', reply_markup: { inline_keyboard: [[{ text: 'Open', callback_data: callback }]] } });
    return;
  }

  if (text) {
    await api.sendMessage({ chat_id: chatId, text: 'Received: ' + text });
  }
}
