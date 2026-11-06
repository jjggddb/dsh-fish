/** Per-conversation delivery facts and bounded operational observations, separate from memory. */
import { join } from 'node:path'
import { readJson, writeAtomic } from './store.js'
import { withFileLock } from './tenant.js'
const file = (root) => join(root, 'group-state.json')
export async function groupState(root) {
  return await readJson(file(root), { groups: {}, recent: [] })
}
export async function mutateGroup(root, groupId, fn) {
  return withFileLock(file(root) + '.lock', async () => {
    const state = await groupState(root)
    state.groups ??= {}
    const g = (state.groups[groupId] ??= {})
    const result = await fn(g, state)
    await writeAtomic(file(root), JSON.stringify(state))
    return result
  })
}
export async function reserveReply(root, groupId, config, now = Date.now(), direct = false) {
  return mutateGroup(root, groupId, (g) => {
    g.replies = (g.replies || []).filter((t) => t > now - 60000)
    if (!direct && g.replies.length >= config.group.maxRepliesPerMinute) return false
    g.replies.push(now)
    return true
  })
}
export async function outcome(root, groupId, result, patch = {}) {
  return mutateGroup(root, groupId, (g, state) => {
    Object.assign(g, patch)
    g.lastOutcome = result.status
    state.recent = [
      ...(state.recent || []),
      { at: new Date().toISOString(), groupId, ...result },
    ].slice(-80)
  })
}
