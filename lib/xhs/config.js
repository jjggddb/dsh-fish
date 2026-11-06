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
  return { enabled, baseUrl: serviceOrigin(baseUrl), accountId, ownerId, intervalMs }
}
