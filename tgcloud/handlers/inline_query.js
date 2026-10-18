import { api } from 'sdk';

export default async function (query) {
  await api.answerInlineQuery({
    inline_query_id: query.id,
    cache_time: 0,
    results: [
      {
        type: 'article',
        id: 'myfa-host',
        title: 'MyFa Host',
        description: 'Telegram-native bot platform',
        input_message_content: {
          message_text: 'MyFa Host — Telegram-native bot platform.',
        },
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Open MyFa Host', callback_data: 'menu' }],
          ],
        },
      },
    ],
  });
}
