export default async function (answer) {
  console.log('Poll answer received', {
    pollId: answer?.poll_id,
    userId: answer?.user?.id,
    optionIds: answer?.option_ids || [],
  });
}
