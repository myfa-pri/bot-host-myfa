import { api } from 'sdk';

export default async function (message) {
  if (!message?.chat) return;
  await api.sendMessage({
    chat_id: message.chat.id,
    text: 'Your message was edited.\n\nNew text: ' + (message.text || '(non-text message)'),
  });
}
