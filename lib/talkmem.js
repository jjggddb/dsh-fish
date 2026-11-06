import { join } from 'node:path'
import { readJson, writeAtomic } from './store.js'
import { withFileLock } from './tenant.js'
export const TALK_KEEP = 6,
  TALK_SNIPPET = 600,
  BUCKET_HOME = 'home',
  BUCKET_GROUP = 'group'
export const bucketOf = (scene, channel = '') => (scene === 'group' ? 'group:' + channel : scene === 'private' && channel.startsWith('wechat-private:') ? 'private:' + channel : 'home')
const file = (root) => join(root, 'talk-recent.json')
export async function addExchange(root, { me, her, scene = 'desk', channel = '' } = {}) {
  return withFileLock(file(root) + '.lock', async () => {
    const old = await readJson(file(root), {})
    const buckets = old.buckets || { home: old.list || [] }
    const key = bucketOf(scene, channel)
    const rows = buckets[key] || []
    rows.push({
      at: new Date().toISOString(),
      me: String(me || '').slice(0, 600),
      her: String(her || '').slice(0, 600),
    })
    buckets[key] = rows.slice(-TALK_KEEP)
    await writeAtomic(file(root), JSON.stringify({ version: 3, buckets }))
    return { ok: true, kept: buckets[key].length }
  })
}
export async function recentExchanges(root, n = TALK_KEEP, scene = 'desk', channel = '') {
  const old = await readJson(file(root), {})
  return (
    old.buckets?.[bucketOf(scene, channel)] ||
    (scene === 'desk' ? old.list : []) ||
    []
  ).slice(-n)
}
export function renderCarry(rows = []) {
  return rows.length
    ? '前一段对话的原话（只作上下文，不是新消息）：\n' +
        rows.map((r) => `${r.me}\n大肥鱼：${r.her || '（沉默）'}`).join('\n')
    : ''
}
