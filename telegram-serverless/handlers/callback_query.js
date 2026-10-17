import { api } from 'sdk';

export default async function (query) {
  if (!query?.id || !query.from?.id) return;

  try {
    const data = String(query.data || '');
    await api.answerCallbackQuery({ callback_query_id: query.id });

    if (data === 'help') {
      await api.sendMessage({
        chat_id: query.message?.chat?.id ?? query.from.id,
        text: 'Use /start to register and /help for supported commands.',
      });
      return;
    }

    if (data === 'open_app_help') {
      await api.sendMessage({
        chat_id: query.message?.chat?.id ?? query.from.id,
        text: 'The Mini App UI must be hosted over HTTPS. The new UI should call Telegram.WebApp.Serverless.call() to reach authenticated named backend endpoints.',
      });
      return;
    }

    if (data === 'check_join') {
      await api.sendMessage({
        chat_id: query.message?.chat?.id ?? query.from.id,
        text: 'Configure the official channel ID and membership check before using this action for access control.',
      });
    }
  } catch (error) {
    console.error('callback handler failed', error);
  }
}
