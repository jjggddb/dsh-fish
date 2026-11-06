const defaultOrigin = 'http://127.0.0.1:18060'
export const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)

export function serviceOrigin(value = defaultOrigin) {
  let url
  try { url = new URL(value) } catch { throw new RangeError('请输入有效的小红书服务地址') }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (!(url.protocol === 'https:' || (local && url.protocol === 'http:')) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new RangeError('请输入不含路径、账号或参数的服务地址；非本机地址须使用 HTTPS')
  return url.origin
}

export const noteKinds = ['video', 'image', 'text']
export const actionNames = ['xhs_comment', 'xhs_publish', 'xhs_share']

function stringList(value, max, length) {
  if (!Array.isArray(value) || value.length > max || value.some(v => typeof v !== 'string' || !v.trim() || v.length > length))
    throw new RangeError('列表中存在过多、过长或空白的条目')
  return [...new Set(value.map(v => v.trim()))]
}

export function xhsSettings(raw = {}) {
  const { enabled = false, baseUrl, accountId = '', ownerId = '', intervalMs = 900000 } = raw
  if (typeof enabled !== 'boolean') throw new RangeError('启用状态必须是布尔值')
  for (const [label, id] of [['鱼账号', accountId], ['主人账号', ownerId]]) {
    if (typeof id !== 'string' || ((id || enabled) && !validId(id)))
      throw new RangeError(label + '需要有效的主页用户 ID')
  }
  if (accountId && accountId === ownerId) throw new RangeError('鱼和主人必须是不同的账号')
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 60000 || intervalMs > 86400000)
    throw new RangeError('自主浏览间隔必须在 1 分钟至 24 小时之间')
  const { dailyMinutes = null, blockedWords = [], allowedTypes = noteKinds, commentEnabled = false,
    publishEnabled = false, shareEnabled = false, shareTarget = null, publishImages = [], dailyActionLimit = 3 } = raw
  if (dailyMinutes !== null && (!Number.isInteger(dailyMinutes) || dailyMinutes < 0 || dailyMinutes > 1440))
    throw new RangeError('每日浏览时长应为 0 至 1440 分钟，留空为不限')
  const kinds = stringList(allowedTypes, 3, 10)
  if (kinds.some(k => !noteKinds.includes(k))) throw new RangeError('笔记类型无效')
  if ([commentEnabled, publishEnabled, shareEnabled].some(v => typeof v !== 'boolean')) throw new RangeError('操作开关无效')
  if (!Number.isInteger(dailyActionLimit) || dailyActionLimit < 1 || dailyActionLimit > 100)
    throw new RangeError('每种外发操作的每日上限应为 1 至 100 次')
  if (shareTarget !== null && (typeof shareTarget !== 'object' || typeof shareTarget.accountId !== 'string' ||
      !/^[A-Za-z0-9_.-]{1,128}$/.test(shareTarget.accountId) ||
      !/^\d+@chatroom$/.test(shareTarget.groupId))) throw new RangeError('分享目标必须是已授权的微信群')
  if (shareEnabled && !shareTarget) throw new RangeError('请先选择分享目标群')
  const images = stringList(publishImages, 18, 2048)
  for (const image of images) {
    let url
    try { url = new URL(image) } catch { throw new RangeError('配图需要有效的 HTTPS 地址') }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
      throw new RangeError('请填写无凭据和查询参数的 HTTPS 配图地址')
  }
  if (publishEnabled && !images.length) throw new RangeError('发布图文需要至少一张已授权配图')
  return { dailyMinutes, blockedWords: stringList(blockedWords, 100, 100), allowedTypes: kinds,
    commentEnabled, publishEnabled, shareEnabled, dailyActionLimit, publishImages: images,
    shareTarget: shareTarget && { accountId: shareTarget.accountId, groupId: shareTarget.groupId },
    enabled, baseUrl: serviceOrigin(baseUrl), accountId, ownerId, intervalMs }
}
