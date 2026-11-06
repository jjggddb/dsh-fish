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

const correctionMarkers = [
  /^(?:更正|纠正|改成|改为|我改(?:选|成|为|口)|(?:刚才|刚刚|我)?(?:发错|说错|打错|记错))/u,
  /^(?:不对|算了)(?:[，,。！!\s]|$)/u,
  /^(?:刚才那(?:句|条)|这条|上一条)?(?:撤回|作废|取消)(?:了|提醒|刚才|上一条|[，,。！!\s]|$)/u,
  /^(?:等一下[，,。！!\s]*)?(?:先)?(?:不用|别|不要)(?:再)?(?:回复|回答|提醒|叫我|理我|[回发答](?:了|[，,。！!\s]|$))/u,
]

/** An explicit correction by the original speaker can still stop a committed group reply. */
export function correctsReply(message, selfId) {
  if (message.quote?.senderId && message.quote.senderId !== selfId && message.quote.senderId !== message.senderId)
    return false
  if ((message.mentions?.userIds || []).some(id => id !== selfId)) return false
  const body = String(message.body || '').trim().replace(/^[@＠][^\s，,：:]+[\s，,：:]+/u, '')
  return correctionMarkers.some(marker => marker.test(body))
}
