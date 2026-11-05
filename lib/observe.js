/** Authenticated, bounded administration API. No login, self-update, persona editor or workspace escape. */
import { readEvents } from './store.js'
import { loadConfig, updateConfig } from './settings.js'
import { groupState } from './group-state.js'
import { readChannels } from './channels.js'
import { collectBackup } from './backup.js'
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
export function registerObserve(ctx, { root, version, tenancy } = {}) {
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
          transport = ctx.get?.('wechatNative')?.status()
        } catch {}
        return send(res, 200, {
          version,
          writable: tenancy.tenant?.ok === true,
          transport,
          rooms: await readChannels(root),
          activity: await groupState(root),
        })
      }
      if (route === 'config') {
        if (req.method === 'GET') return send(res, 200, (await loadConfig(root)).config)
        if (req.method === 'POST') {
          if (!tenancy.tenant?.ok) return send(res, 409, { error: 'Read only' })
          return send(res, 200, await updateConfig(await body(req), root))
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
