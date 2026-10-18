import { api } from 'sdk';

// Shipping is not part of the current MyFa Host product flow.
export default async function (query) {
  await api.answerShippingQuery({
    shipping_query_id: query.id,
    ok: false,
    error_message: 'Shipping is not enabled in MyFa Host.',
  });
}
