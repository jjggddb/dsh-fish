/** Durable resource budgets and bounded operational observations, separate from memory. */
import { join } from 'node:path'
import { readJson, writeAtomic } from './store.js'
import { withFileLock } from './tenant.js'
import { dateKey } from './settings.js'
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
export async function observeInput(root, groupId) {
  return mutateGroup(root, groupId, (g) => {
    g.lastInput = Date.now()
  })
}
export async function reserveTurn(
  root,
  groupId,
  config,
  { scheduled = false, direct = false, now = Date.now() } = {},
) {
  return mutateGroup(root, groupId, (g) => {
    const bucket = direct ? 'directTurns' : 'turns'
    g[bucket] = (g[bucket] || []).filter(t => t > now - 3600000)
    if (g[bucket].length >= (direct ? config.group.maxDirectTurnsPerHour : config.group.maxTurnsPerHour)) return false
    if (scheduled) {
      const day = dateKey(new Date(now), config.group.timezone)
      if (g.day !== day) {
        g.day = day
        g.proactiveCount = 0
      }
      if (
        !config.proactive.enabled ||
        g.proactiveCount >= config.proactive.maxPerDay ||
        now - (g.lastInput || 0) < config.proactive.minIdleMinutes * 60000 ||
        now - (g.lastProactive || 0) < config.proactive.intervalMinutes * 60000
      )
        return false
      // Reserve BEFORE inference: restart cannot duplicate an admitted timer slot.
      g.lastProactive = now
      g.proactiveCount = (g.proactiveCount || 0) + 1
    }
    g[bucket].push(now)
    return true
  })
}
export async function reserveReply(root, groupId, config, now = Date.now(), direct = false) {
  return mutateGroup(root, groupId, (g) => {
    g.replies = (g.replies || []).filter((t) => t > now - 60000)
    // Leave one slot for a direct response when the configured limit permits it.
    const limit = config.group.maxRepliesPerMinute
    if (g.replies.length >= (direct ? limit : Math.max(1, limit - 1))) return false
    g.replies.push(now)
    return true
  })
}
export async function outcome(root, groupId, result) {
  return mutateGroup(root, groupId, (g, state) => {
    g.lastOutcome = result.status
    state.recent = [
      ...(state.recent || []),
      { at: new Date().toISOString(), groupId, ...result },
    ].slice(-80)
  })
}
