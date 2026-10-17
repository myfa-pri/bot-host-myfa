import { api } from 'sdk';

export default async function (query) {
  if (!query?.id) return;
  try {
    await api.answerInlineQuery({
      inline_query_id: query.id,
      results: [],
      cache_time: 1,
      is_personal: true,
    });
  } catch (error) {
    console.error('inline query handler failed', error);
  }
}
