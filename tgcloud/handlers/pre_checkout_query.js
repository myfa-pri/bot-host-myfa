import { api } from 'sdk';

// Payments are deliberately disabled until MyFa Host has product/price validation.
export default async function (query) {
  await api.answerPreCheckoutQuery({
    pre_checkout_query_id: query.id,
    ok: false,
    error_message: 'MyFa Host payments are not enabled yet.',
  });
}
