import { api } from 'sdk';

export async function sendText(chatId, text, extra = {}) {
  return await api.sendMessage({
    chat_id: chatId,
    text: String(text),
    ...extra,
  });
}

export async function answerCallback(callbackQueryId, text) {
  return await api.answerCallbackQuery({
    callback_query_id: callbackQueryId,
    ...(text ? { text: String(text) } : {}),
  });
}

export async function isChannelMember(channelId, userId) {
  const member = await api.getChatMember({
    chat_id: channelId,
    user_id: Number(userId),
  });
  return ['creator', 'administrator', 'member'].includes(member.status) ||
    (member.status === 'restricted' && member.is_member === true);
}
