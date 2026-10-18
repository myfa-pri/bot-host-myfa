import { api } from 'sdk';

export default async function (query) {
  await api.answerInlineQuery({
    inline_query_id: query.id,
    results: [
      {
        type: 'article',
        id: 'myfa-host',
        title: 'MyFa Host',
        description: 'Telegram-native bot management platform',
        input_message_content: {
          message_text: 'MyFa Host\n\nTelegram-native bot management platform.',
        },
      },
    ],
    cache_time: 0,
    is_personal: true,
  });
}
