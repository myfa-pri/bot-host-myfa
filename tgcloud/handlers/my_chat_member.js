import { api } from 'sdk';

export default async function (update) {
  const chat = update?.chat;
  const status = update?.new_chat_member?.status;
  if (!chat) return;

  console.log('MyFa Host bot membership changed', {
    chatId: chat.id,
    status,
  });

  if (status === 'kicked') {
    console.warn('Bot was removed from chat', chat.id);
  }
}
