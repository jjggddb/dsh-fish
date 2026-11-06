import { join } from 'node:path'
import { identityFor } from './selfdoc.js'
import { activeTurn, scopeFor, scopeRoot } from './scope.js'
import { isHerAgent } from './restrict.js'
import { readNotes, renderNotes } from './note.js'
export const IDENTITY_SECTION = 'fish:identity',
  IDENTITY_ORDER = 8500,
  HOST_PERSONA_SECTION = 'deployment:persona-prefix',
  HOST_HARNESS_SECTION = 'harness:identity'
export function reorderForHer(assembly) {
  if (!assembly || !Array.isArray(assembly.sections)) return assembly
  const kept = assembly.sections.filter((s) => String(s?.name ?? '') !== HOST_PERSONA_SECTION)
  const mine = kept.find((s) => String(s?.name ?? '') === IDENTITY_SECTION)
  if (!mine) {
    // 没找到她的段（宿主换名字/还没挂上）：只做摘掉那一步，别乱动顺序。
    assembly.sections = kept
    return assembly
  }
  const rest = kept.filter((s) => s !== mine)
  const at = rest.findIndex((s) => String(s?.name ?? '') === HOST_HARNESS_SECTION)
  // 宿主的 harness:identity 不见了就放到最前面——她的身份永远第一个被读到。
  const insertAt = at >= 0 ? at + 1 : 0
  rest.splice(insertAt, 0, mine)
  assembly.sections = rest
  return assembly
}

/**
 * 把 <code>reorderForHer</code> 挂到这条 agent 的组装链上。
 *
 * 挂不上不算失败（老宿主没有 `system-prompt/assemble`）：返回 undefined，
 * 她只是回到「coding agent 在前、身份在后」的旧样子，不影响其它任何事。
 *
 * @param {object} agent
 * @returns {(() => void)|undefined} 卸载函数
 */
export function attachAssembleFix(agent) {
  const ctx = agent?.ctx
  if (!ctx || typeof ctx.on !== 'function') return undefined
  try {
    // prepend: true —— 排在最外层先跑，先 `await next()` 拿到宿主组装结果再整改，
    // 这样别的插件后加的段也一起被我们整理（宿主自己的三处也这么用）。
    const off = ctx.on(
      'system-prompt/assemble',
      async (_assembly, _context, next) => {
        const assembled = await next()
        // 整改失败必须原样放行：这条链断掉等于她一整轮读不到任何系统提示词，
        // 比「coding agent 排在前面」糟得多。
        try {
          return reorderForHer(assembled)
        } catch {
          return assembled
        }
      },
      { prepend: true },
    )
    return typeof off === 'function' ? off : undefined
  } catch {
    return undefined
  }
}

export function registerIdentity(ctx, { root, herDir = join(root, 'home') } = {}) {
  return ctx.on('agent/created', async ({ agent }) => {
    if (!isHerAgent(agent, herDir)) return
    if (typeof agent.ctx?.systemPrompt?.section !== 'function')
      throw Error('Fish requires system prompt sections')
    const sessionId = agent.session?.id ?? agent.session?.header?.id
    const scope = await scopeFor(root, { agent }),
      fallback = await identityFor(
        root,
        (scope.scene === 'group' || (scope.scene === 'private' && scope.groupId)) ? scope : { scene: 'group', groupId: '__unbound__', accountId: '' },
      )
    agent.ctx.systemPrompt.section({
      name: IDENTITY_SECTION,
      order: IDENTITY_ORDER,
      interpolate: false,
      text: () => activeTurn(root, sessionId)?.identityText || fallback,
    })
    const notes =
      (scope.scene === 'group' || (scope.scene === 'private' && scope.groupId)) ? renderNotes(await readNotes(scopeRoot(root, scope))) : ''
    agent.ctx.systemPrompt.section({
      name: 'fish:notes',
      order: 8550,
      interpolate: false,
      text: () => activeTurn(root, sessionId)?.notesText ?? notes,
    })
    const off = attachAssembleFix(agent)
    if (off) agent.ctx.effect(() => off)
  })
}
