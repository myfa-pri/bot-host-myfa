import { api } from 'sdk';

export default async function (query) {
  if (!query?.id || !query.from?.id) return;

  try {
    const data = String(query.data || '');
    await api.answerCallbackQuery({ callback_query_id: query.id });

    if (data === 'help') {
      await api.sendMessage({
        chat_id: query.message?.chat?.id || query.from.id,
        text: 'Use /start to register and /help to see supported commands. The Mini App frontend must be hosted over HTTPS and call Telegram.WebApp.Serverless.call for authenticated backend operations.',
      });
      return;
    }

    if (data === 'open_app_help') {
      await api.sendMessage({
        chat_id: query.message?.chat?.id || query.from.id,
        text: 'To connect the Mini App, host the existing UI on HTTPS, configure its URL in BotFather, then call named Serverless endpoints with Telegram.WebApp.Serverless.call. Do not use a client-supplied userId for authorization.',
      });
      return;
    }

    if (data === 'check_join') {
      // Configure the official channel ID and enable channel membership checks
      // before using this callback in production.
      await api.sendMessage({
        chat_id: query.message?.chat?.id || query.from.id,
        text: 'Channel membership checks must be configured for your official channel before this action can approve access.',
      });
    }
  } catch (error) {
    console.error('callback handler failed', error);
  }
}
