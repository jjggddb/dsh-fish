/** One serialized DSH turn per group. Only a correlated completed turn may send. */
import { randomUUID } from 'node:crypto'
import { readChannels, saveChannel, channelTitle } from './channels.js'
import { ensureWorkspace } from './home.js'
import { loadConfig } from './settings.js'
import { addExchange, recentExchanges, renderCarry } from './talkmem.js'
import { bindTurn, scopeRoot } from './scope.js'
import { identityFor } from './selfdoc.js'
import { readNotes, renderNotes } from './note.js'
import { sanitizeForeign } from './guard.js'
const locks = new Map()
export function beginTurnWait(ctx, sessionId, timeoutMs, requestId) {
  let current = null,
    matched = null,
    reply = '',
    timer,
    off,
    settle,
    done = false
  const promise = new Promise((r) => (settle = r))
  const finish = (reason = 'cancelled') => {
    if (done) return
    done = true
    clearTimeout(timer)
    off?.()
    settle({ completed: reason === 'completed', reason, reply })
  }
  off = ctx.on('session/event', (session, event) => {
    if ((session?.id ?? session?.header?.id) !== sessionId) return
    if (event.type === 'turn/start') current = event.data?.turn
    if (
      event.type === 'user/message' &&
      (event.data?.source?.rpcId ?? event.data?.message?.source?.rpcId) === requestId
    )
      matched = event.data?.turn ?? current
    if (matched == null || event.data?.turn !== matched) return
    if (event.type === 'assistant/message') {
      const blocks = event.data?.message?.content || []
      if (!blocks.some((b) => b.type === 'tool-call'))
        reply = blocks
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('')
    }
    if (event.type === 'turn/end') finish(event.data?.reason?.kind || 'unknown')
  })
  timer = setTimeout(() => finish('timeout'), timeoutMs)
  return { wait: () => promise, cancel: () => finish(), reply: () => reply }
}
export async function sayToHer(ctx, text, deps = {}) {
  const key = deps.root + '\0' + deps.channel,
    previous = locks.get(key) || Promise.resolve()
  const run = previous.catch(() => {}).then(() => runTurn(ctx, text, deps))
  locks.set(key, run)
  try {
    return await run
  } finally {
    if (locks.get(key) === run) locks.delete(key)
  }
}
async function runTurn(ctx, text, { root, channel, scope, waitMs = 120000, signal } = {}) {
  if (!scope?.groupId || !scope.accountId || !channel) throw Error('Trusted group scope required')
  const { config } = await loadConfig(root),
    sc = ctx.sessionController
  const scene = scope.scene === 'private' ? 'private' : 'group'
  let room = (await readChannels(root)).find((r) => r.key === channel),
    sessionId = room?.sessionId
  if (room?.accountId && room.accountId !== scope.accountId) throw Error('Group account changed')
  const rotating = Boolean(room && room.turns >= config.chat.rotateAfter)
  if (rotating) sessionId = ''
  if (sessionId && typeof sc.resolveAgent === 'function') {
    try {
      const live = await sc.resolveAgent(sessionId)
      if (!live?.agent) sessionId = ''
    } catch {
      sessionId = ''
    }
  }
  if (!sessionId) {
    const home = await ensureWorkspace(ctx, { root })
    if (!home.ok) throw Error('Group workspace unavailable')
    const created = await sc.create({ workspaceId: home.wsId })
    sessionId = created?.sessionId ?? created?.id
    if (!sessionId) throw Error('Group session unavailable')
    if (room?.sessionId)
      await sc
        .rename?.({ sessionId: room.sessionId, title: channelTitle(channel, scene) + ' · 已续接' })
        .catch(() => {})
    await sc.rename?.({ sessionId, title: channelTitle(channel, scene) }).catch(() => {})
    const saved = await saveChannel(root, {
      channel, scene,
      sessionId,
      accountId: scope.accountId,
      groupId: scope.groupId,
    })
    if (!saved.ok) throw Error('Cannot persist group session')
    room = saved.entry
  }
  const current = { ...scope, scene, channel, sessionId, decision: null }
  current.identityText = await identityFor(root, current)
  current.notesText = renderNotes(await readNotes(scopeRoot(root, current)))
  const release = bindTurn(root, sessionId, current)
  const requestId = 'fish-group-' + randomUUID(),
    wait = beginTurnWait(ctx, sessionId, waitMs, requestId),
    abort = new AbortController()
  const stop = () => {
    abort.abort()
    wait.cancel()
    try {
      sc.cancel?.({ sessionId })
    } catch {}
  }
  signal?.addEventListener('abort', stop, { once: true })
  const timer = setTimeout(stop, waitMs + 1000)
  try {
    if (signal?.aborted) throw Error('Channel disposed')
    const carry = renderCarry(await recentExchanges(root, 6, scene, channel))
    const input = [
      carry,
      scene === 'private' ? '本轮微信私聊：' : '本轮群聊观察：',
      sanitizeForeign(text).text,
      '你可以旁听、用 growth_commit 记忆，或参与聊天。最后调用 fish_decide：silent 表示沉默；reply 的 text 才会发送到当前会话。唤醒不是必须发言，不输出工具说明或思考过程。',
    ]
      .filter(Boolean)
      .join('\n\n')
    // Do not await the RPC before the deadline: a stuck admission must not pin the queue.
    const admitted = Promise.resolve(
      sc.prompt(
        { requestId, sessionId, mode: 'queue', content: [{ type: 'text', text: input }] },
        abort.signal,
      ),
    ).catch(() => {
      wait.cancel()
    })
    const result = await wait.wait()
    if (!result.completed) {
      abort.abort()
      try {
        sc.cancel?.({ sessionId })
      } catch {}
    }
    void admitted
    await addExchange(root, {
      me: text,
      her: result.completed ? current.decision?.text || '' : '',
      scene,
      channel,
    })
    await saveChannel(root, {
      channel, scene,
      sessionId,
      accountId: scope.accountId,
      groupId: scope.groupId,
      turns: result.completed ? (room?.turns || 0) + 1 : config.chat.rotateAfter,
    })
    return {
      ok: result.completed,
      reason: result.reason,
      decision: result.completed ? current.decision : null,
      image: result.completed ? current.image : null,
      sessionId,
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', stop)
    wait.cancel()
    release()
  }
}
