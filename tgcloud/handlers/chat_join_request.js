export default async function (update) {
  // Log only. Approval is intentionally not automatic because access rules belong to MyFa Host.
  console.log('chat_join_request received', JSON.stringify(update));
}
