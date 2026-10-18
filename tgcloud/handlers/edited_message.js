import { api } from 'sdk';
import { logActivity } from '../lib/users.js';

export default async function (message) {
  if (!message?.chat?.id) return;

  if (message.from?.id) {
    await logActivity(message.from.id, 'edited_message', String(message.text || '').slice(0, 200));
  }

  await api.sendMessage({
    chat_id: message.chat.id,
    text: 'Your message was edited.\n\n' + (message.text || '(non-text message)'),
  });
}
