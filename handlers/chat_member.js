import { api } from 'sdk';

export default async function (update) {
  const user = update?.new_chat_member?.user;
  const chat = update?.chat;
  const status = update?.new_chat_member?.status;

  if (!user?.id || !chat?.id) return;

  console.log('Chat membership changed', {
    userId: user.id,
    chatId: chat.id,
    status,
  });

  if (status === 'member' || status === 'administrator') {
    try {
      await api.sendMessage({
        chat_id: user.id,
        text: 'Membership confirmed. You can continue using MyFa Host.',
      });
    } catch (error) {
      console.warn('Could not send membership confirmation', error);
    }
  }
}
