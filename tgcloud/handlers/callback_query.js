import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { users, ownedBots, botCommands } from '../schema.js';

async function edit(chatId, messageId, text, keyboard) {
  await api.editMessageText({
    chat_id: chatId,
    message_id: messageId,
    text,
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
  });
}

export default async function (query, ctx) {
  if (!query?.id) return;

  await api.answerCallbackQuery({ callback_query_id: query.id });

  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  const userId = query.from?.id;
  const data = String(query.data || '');

  if (!chatId || !messageId || !userId) return;

  if (data === 'profile') {
    const user = await db.select().from(users).where(eq(users.tgId, Number(userId))).get();
    await edit(chatId, messageId,
      'MYFA HOST PROFILE\n\n' +
      'Name: ' + (user?.firstName || query.from.first_name || 'User') + '\n' +
      'Username: ' + (user?.username ? '@' + user.username : 'Not set') + '\n' +
      'Plan: ' + (user?.plan || 'free') + '\n' +
      'Level: ' + (user?.level || 1) + '\n' +
      'Gems: ' + (user?.gems || 0) + '\n' +
      'Coins: ' + (user?.coins || 0),
      [[{ text: 'Back', callback_data: 'menu' }]]);
    return;
  }

  if (data === 'balance') {
    const user = await db.select().from(users).where(eq(users.tgId, Number(userId))).get();
    await edit(chatId, messageId,
      'MYFA HOST BALANCE\n\nGems: ' + (user?.gems || 0) + '\nCoins: ' + (user?.coins || 0),
      [[{ text: 'Back', callback_data: 'menu' }]]);
    return;
  }

  if (data === 'bots') {
    const bots = await db.select().from(ownedBots).where(eq(ownedBots.ownerTgId, Number(userId))).all();
    const rows = bots.slice(0, 8).map((bot) => [
      { text: bot.displayName, callback_data: 'bot:' + bot.telegramBotId },
    ]);
    rows.push([{ text: 'Back', callback_data: 'menu' }]);
    await edit(chatId, messageId,
      bots.length
        ? 'MY BOTS\n\nManaged bots: ' + bots.length
        : 'MY BOTS\n\nNo managed bots are connected yet.\n\nUse the Mini App to start the managed-bot creation flow.',
      rows);
    return;
  }

  if (data.startsWith('bot:')) {
    const botId = data.slice(4);
    const bot = await db.select().from(ownedBots).where(eq(ownedBots.telegramBotId, botId)).get();
    if (!bot || Number(bot.ownerTgId) !== Number(userId)) {
      await edit(chatId, messageId, 'Bot not found or access denied.', [[{ text: 'Back', callback_data: 'bots' }]]);
      return;
    }
    const commandCount = await db.$count(botCommands, eq(botCommands.telegramBotId, botId));
    await edit(chatId, messageId,
      'BOT\n\n' + bot.displayName + '\n' +
      (bot.username ? '@' + bot.username : '') + '\n\n' +
      'Status: ' + bot.status + '\nCommands: ' + commandCount,
      [[{ text: 'Back', callback_data: 'bots' }]]);
    return;
  }

  if (data === 'templates') {
    await edit(chatId, messageId,
      'TEMPLATES\n\nFULL PROJECTS\nSINGLE COMMANDS\n\nTemplate migration is ready for the Mini App.',
      [[{ text: 'Back', callback_data: 'menu' }]]);
    return;
  }

  if (data === 'settings') {
    await edit(chatId, messageId,
      'SETTINGS\n\nYour Telegram identity is verified automatically by Serverless.',
      [[{ text: 'Back', callback_data: 'menu' }]]);
    return;
  }

  if (data === 'help' || data === 'commands') {
    await edit(chatId, messageId,
      'MYFA HOST HELP\n\n/start\n/help\n/menu\n/buttons\n/keyboard\n/poll\n/status',
      [[{ text: 'Back', callback_data: 'menu' }]]);
    return;
  }

  if (data === 'menu') {
    await edit(chatId, messageId, 'MYFA HOST MENU', [
      [
        { text: 'Profile', callback_data: 'profile' },
        { text: 'Balance', callback_data: 'balance' },
      ],
      [
        { text: 'My Bots', callback_data: 'bots' },
        { text: 'Templates', callback_data: 'templates' },
      ],
      [{ text: 'Help', callback_data: 'help' }],
    ]);
    return;
  }

  await api.sendMessage({ chat_id: chatId, text: 'Unknown action: ' + data });
}
