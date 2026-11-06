/** Addressing someone by name is different from mentioning them in a story. */
export function directlyAddressed(message, selfId) {
  if (message.threadId && !message.threadId.endsWith('@chatroom')) return true
  if (
    message.mentions?.self ||
    (selfId && (message.mentions?.userIds?.includes(selfId) || message.quote?.senderId === selfId))
  )
    return true
  if (message.quote?.senderId && message.quote.senderId !== selfId) return false
  return /^(?:(?:请问|想问(?:一下|问)?|问下|问问)?[\s@＠]*(?:大肥鱼|小鲸鱼)[啊呀]?(?:[，,、：:！!？?\s]|$|在吗|在不在|你|请|帮|觉得|怎么看|能不能|能帮|来一下))/.test(
    message.body || '',
  )
}

export function possibleContinuation(m, lastReply, now = Date.now()) {
  const age = now - (lastReply?.at || 0)
  const stamp = Date.parse(m.createdAt)
  const expecting = lastReply?.awaiting?.includes(m.senderId)
  const inConversation = age <= 120000 && lastReply?.peer === m.senderId
  return (
    !!lastReply &&
    (expecting || inConversation) &&
    (!Number.isFinite(stamp) || stamp >= lastReply.at - 1000) &&
    age >= 0 &&
    age <= 600000 &&
    (!m.quote?.senderId || m.quote.senderId === lastReply.selfId) &&
    !(m.mentions?.userIds || []).some((id) => id !== lastReply.selfId)
  )
}
