/** Trusted provenance is supplied by the channel, never by model arguments. */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { readChannels } from './channels.js'
import { readEvents } from './store.js'
import { callerOf } from './tenant.js'
const active = new Map()
const key = (root, id) => root + '\0' + id
export function bindTurn(root, sessionId, scope) {
  const k = key(root, sessionId)
  if (active.has(k)) throw Error('Session already has an active turn')
  active.set(k, scope)
  return () => {
    if (active.get(k) === scope) active.delete(k)
  }
}
export function activeTurn(root, sessionId) {
  return active.get(key(root, sessionId))
}
export async function scopeFor(root, exec) {
  const { sessionId } = callerOf(exec)
  const live = activeTurn(root, sessionId)
  if (live) return live
  const room = (await readChannels(root)).find(
    (r) => r.sessionId === sessionId || r.previousSessionIds.includes(sessionId),
  )
  if (room && (room.scene === 'group' || room.key.startsWith('wechat-private:')))
    return {
      inactive: true,
      scene: room.scene,
      personId: room.scene === 'private' ? room.groupId : '',
      groupId: room.groupId || room.key.replace(/^wechat-group:/, ''),
      accountId: room.accountId || '',
      channel: room.key,
      sessionId,
    }
  return { scene: 'desk', sessionId }
}
export function provenance(scope = {}) {
  return Object.fromEntries(
    ['scene', 'accountId', 'groupId', 'personId', 'messageId', 'turnId']
      .filter((k) => typeof scope[k] === 'string' && scope[k] && !(k === 'groupId' && scope.scene === 'private'))
      .map((k) => [k, scope[k]]),
  )
}
export function visibleEvents(events, scope = {}) {
  return events.filter(
    (e) =>
      e.type === 'seed' ||
      (e.type === 'meta' && /^import-(name|mark):/.test(e.text || '')) ||
      (scope.scene === 'group'
        ? e.scene === 'group' && e.groupId === scope.groupId && e.accountId === scope.accountId
        : scope.scene === 'private' && scope.accountId && scope.groupId
          ? e.scene === 'private' && e.accountId === scope.accountId && e.personId === scope.groupId
          : !e.groupId && e.scene !== 'group' && !(e.scene === 'private' && e.accountId)),
  )
}
export function scopeRoot(root, scope = {}) {
  if (scope.scene !== 'group' && !(scope.scene === 'private' && scope.groupId && scope.accountId)) return root
  return join(
    root,
    scope.scene === 'private' ? 'contacts' : 'groups',
    createHash('sha256')
      .update((scope.accountId || '') + '\0' + scope.groupId)
      .digest('hex')
      .slice(0, 24),
  )
}

/** Read-only attribution of legacy events whose DSH session is provably this room. */
export async function memoryEvents(root, scope = {}) {
  const { events } = await readEvents(root)
  if (scope.scene !== 'group') return visibleEvents(events, scope)
  const rooms = await readChannels(root),
    room = rooms.find(
      (r) =>
        r.scene === 'group' &&
        (r.groupId || r.key.replace(/^wechat-group:/, '')) === scope.groupId &&
        (!r.accountId || r.accountId === scope.accountId),
    )
  const sessions = new Set(room ? [room.sessionId, ...room.previousSessionIds] : [])
  return visibleEvents(
    events.map((e) =>
      !e.groupId && e.sessionId && sessions.has(e.sessionId)
        ? { ...e, scene: 'group', groupId: scope.groupId, accountId: scope.accountId }
        : e,
    ),
    scope,
  )
}
