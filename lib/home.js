/** Resolve the dedicated Fish workspace; never use other workspaces. */
import {promises as fs} from 'node:fs'
import {join} from 'node:path'
import {rootDir,paths} from './store.js'
const TITLE_WORKSPACE='大肥鱼的家'
export async function ensureHomeDir(root = rootDir()) {
  const dir = join(paths(root).root, 'home')
  await fs.mkdir(dir, { recursive: true })
  return dir
}

function readRegistry(ctx) {
  try { return ctx.get?.('workspaceRegistry') ?? null } catch { return null }
}

function pathKey(p) {
  // Windows 大小写不敏感；其余平台保持原样。只用于比对，不用于文件访问。
  const s = String(p ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? s.toLowerCase() : s
}

/**
 * 找到或创建工作区。**先查后建**：宿主 create 本身是幂等的，但明查一遍能拿到
 * 已存在的 title / id，避免依赖实现细节。
 */
export async function ensureWorkspace(ctx, { root = rootDir(), title = TITLE_WORKSPACE } = {}) {
  const dir = await ensureHomeDir(root)
  const reg = readRegistry(ctx)
  if (!reg?.create) return { ok: false, why: '宿主没有 workspaceRegistry 服务', dir }

  let ws = null
  try {
    const list = typeof reg.list === 'function' ? reg.list() : []
    ws = list.find((w) => w && w.path && pathKey(w.path) === pathKey(dir)) ?? null
  } catch { /* list 不可用就直接 create */ }

  const existed = Boolean(ws)

  // 老档改名：早期版本把工作区叫「鱼」，现在统一叫「大肥鱼的家」。
  // 宿主真正的改名入口在**实体**上：registry.list()/get() 返回的 Workspace 有 setTitle(title)；
  // registry 自己**没有** update/rename（2026-10-25 从 app.asar 核实）。
  // 早先那版调 reg.update/reg.rename，两个都不存在、又被 catch 吞掉，所以标题一直是「鱼」。
  // 改不动的仍然保持原名——她那间屋子还能住，只是侧栏名不对。
  let renamed = false
  if (ws && title && String(ws.title ?? '') !== title) {
    try {
      if (typeof ws.setTitle === 'function') {
        await ws.setTitle(title)
        renamed = true
      } else if (typeof reg.rename === 'function') {
        await reg.rename(ws.id ?? ws.workspaceId, title)
        renamed = true
      }
    } catch { renamed = false }
  }

  if (!ws) {
    try {
      ws = await reg.create(dir, title)
    } catch (err) {
      return { ok: false, why: `建工作区失败：${String(err?.message ?? err).slice(0, 120)}`, dir }
    }
  }

  const wsId = String(ws?.id ?? ws?.workspaceId ?? '')
  if (!wsId) return { ok: false, why: '宿主返回的工作区没有 id', dir }
  return { ok: true, wsId, dir, created: !existed, renamed }
}
