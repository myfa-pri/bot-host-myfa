import { logActivity } from '../lib/users.js';

export default async function (answer) {
  if (!answer?.user?.id) return;

  await logActivity(
    answer.user.id,
    'poll_answer',
    JSON.stringify({ pollId: answer.poll_id, optionIds: answer.option_ids }).slice(0, 2000),
  );
}
