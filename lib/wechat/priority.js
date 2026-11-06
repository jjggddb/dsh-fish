/** Only a direct conversation or trusted WeChat mention/quote addresses Fish. */
export function directlyAddressed(message, selfId) {
  if (!message.threadId?.endsWith('@chatroom')) return true
  return !!(
    message.mentions?.self ||
    (selfId && (message.mentions?.userIds?.includes(selfId) || message.quote?.senderId === selfId))
  )
}
