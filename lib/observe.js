/** Authenticated, bounded administration API. No login, self-update, persona editor or workspace escape. */
import { readEvents } from './store.js'
import { loadConfig, updateConfig } from './settings.js'
import { groupState } from './group-state.js'
import { readChannels } from './channels.js'
import { collectBackup } from './backup.js'
import { toolCatalog } from './restrict.js'
import { parseToolNames } from './settings.js'
const send = (res, status, value) => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(value))
}
async function body(req) {
  let text = ''
  for await (const chunk of req) {
    text += chunk
    if (Buffer.byteLength(text) > 16384) throw Error('Body too large')
  }
  return JSON.parse(text || '{}')
}
export function registerObserve(ctx, { root, version, tenancy, transport: getTransport = () => undefined, catalog } = {}) {
  const server = ctx.get?.('webServer') ?? ctx.webServer
  const handler = async (req, res) => {
    const connection = ctx.get?.('connection') ?? ctx.connection
    if (typeof connection?.requestRejection !== 'function')
      return send(res, 503, { error: 'Authentication unavailable' })
    try {
      const rejection = connection.requestRejection(req)
      if (rejection) return send(res, rejection.status || 403, { error: 'Authentication required' })
    } catch {
      return send(res, 503, { error: 'Authentication unavailable' })
    }
    const route = new URL(req.url, 'http://localhost').pathname.replace(/\/+$/, '').split('/').pop()
    try {
      if (req.method === 'GET' && route === 'whoami')
        return send(res, 200, {
          plugin: 'dsh-fish',
          version,
          writable: tenancy.tenant?.ok === true,
        })
      if (req.method === 'GET' && route === 'status') {
        let transport
        try {
          const native = getTransport()
          if (native) transport = { ...native.status(), ...native.identity(), groups: native.authorizedGroups() }
        } catch {}
        return send(res, 200, {
          version,
          writable: tenancy.tenant?.ok === true,
          transport,
          rooms: await readChannels(root),
          activity: await groupState(root),
        })
      }
      if (req.method === 'GET' && route === 'tools')
        return send(res, 200, { tools: toolCatalog(ctx, catalog) })
      if (route === 'config') {
        if (req.method === 'GET') return send(res, 200, (await loadConfig(root)).config)
        if (req.method === 'POST') {
          if (!tenancy.tenant?.ok) return send(res, 409, { error: 'Read only' })
          const patch = await body(req)
          if (patch.tools && Object.hasOwn(patch.tools, 'allow')) {
            const input = patch.tools.allow
            if (!Array.isArray(input) || input.some((n) => typeof n !== 'string' || parseToolNames([n])[0] !== n))
              return send(res, 400, { error: '工具名单必须是有效工具名数组' })
            const known = new Set(toolCatalog(ctx, catalog).map((t) => t.name))
            const previous = (await loadConfig(root)).config.tools.allow
            // Preserve existing unavailable selections so another setting can still be saved.
            const unknown = input.filter((n) => !known.has(n) && !previous.includes(n))
            if (unknown.length) return send(res, 400, { error: '工具尚未注册：' + unknown.join('、') })
          }
          return send(res, 200, await updateConfig(patch, root))
        }
      }
      if (req.method === 'GET' && route === 'events') {
        const { events } = await readEvents(root)
        return send(res, 200, { events: events.filter((e) => e.type !== 'seed').slice(-80) })
      }
      if (req.method === 'GET' && route === 'backup')
        return send(res, 200, await collectBackup(root))
      return send(res, 404, { error: 'Unknown route' })
    } catch {
      return send(res, 500, { error: 'Operation failed; check private service logs' })
    }
  }
  const off = server?.register?.({ kind: 'prefix', path: '/dsh-fish/', handler })
  return {
    dispose() {
      if (typeof off === 'function') off()
      else off?.dispose?.()
    },
  }
}
