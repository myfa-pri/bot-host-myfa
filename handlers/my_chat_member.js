export default async function (update) {
  const chat = update?.chat;
  const status = update?.new_chat_member?.status;

  if (!chat?.id) return;

  console.log('My bot membership changed', {
    chatId: chat.id,
    status,
  });
}
