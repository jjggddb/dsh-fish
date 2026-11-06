/** Authenticated, bounded administration API. No login, self-update, persona editor or workspace escape. */
import { readEvents } from './store.js'
import { loadConfig, updateConfig } from './settings.js'
import { groupState } from './group-state.js'
import { readChannels } from './channels.js'
import { collectBackup } from './backup.js'
import { toolCatalog } from './restrict.js'
import { parseToolNames } from './settings.js'
import { readFile } from 'node:fs/promises'
import { avatarFile, avatarInfo, removeAvatar, saveAvatar } from './avatar.js'
import { changeSticker, listStickers, stickerBytes } from './stickers.js'
import { settingsState, settingsDiary } from './settings-view.js'
const send = (res, status, value) => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(value))
}
async function body(req, limit = 16384) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > limit) throw Error('Body too large')
    chunks.push(bytes)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}
export function registerObserve(ctx, { root, version, tenancy, transport: getTransport = () => undefined, admin = () => undefined, wake, catalog, xhsAdmin = () => undefined } = {}) {
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
    const url = new URL(req.url, 'http://localhost')
    const route = url.pathname.replace(/^\/dsh-fish\/?/, '').replace(/\/+$/, '')
    try {
      if (route === 'state' && req.method === 'GET') return send(res, 200, await settingsState(root))
      if (route === 'diary' && req.method === 'GET') return send(res, 200, await settingsDiary(root, url.searchParams))
      if (req.method === 'POST' && !tenancy.tenant?.ok) return send(res, 409, { error: '当前为只读状态' })
      if (route === 'xhs/settings') {
        const api = xhsAdmin()
        if (!api) return send(res, 503, { error: '小红书设置尚未就绪' })
        if (req.method === 'GET') return send(res, 200, api.info())
        if (req.method === 'POST') {
          let input
          try { input = await body(req) } catch { return send(res, 400, { error: '小红书设置格式无效' }) }
          try { return send(res, 200, await api.save(input)) }
          catch (error) {
            if (error instanceof RangeError) return send(res, 400, { error: error.message })
            throw error
          }
        }
      }
      if (route === 'stickers' && req.method === 'GET') return send(res, 200, listStickers(root))
      if (route === 'stickers' && req.method === 'POST') {
        let input
        try { input = await body(req, 5_600_000) }
        catch { return send(res, 400, { error: '图片过大或请求格式无效' }) }
        try { return send(res, 200, await changeSticker(root, input || {})) }
        catch (err) {
          if (err.code === 'INVALID_STICKER') return send(res, 400, { error: err.message })
          throw err
        }
      }
      if (route === 'stickers/image' && req.method === 'GET') {
        const item = listStickers(root).find(item => item.id === url.searchParams.get('id'))
        if (!item) return send(res, 404, { error: '表情不存在' })
        const bytes = await stickerBytes(root, item)
        res.writeHead(200, { 'content-type': item.mime, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
        return res.end(bytes)
      }
      if (route === 'avatar' && req.method === 'POST') {
        const input = await body(req, 3_000_000)
        const r = input.remove ? removeAvatar(root) : saveAvatar(root, input)
        return send(res, r.ok ? 200 : 400, r.ok ? avatarInfo(root) : { error: r.why })
      }
      if (route === 'avatar' && req.method === 'GET') {
        const file = avatarFile(root)
        if (!file) return send(res, 404, { error: '尚未设置头像' })
        const bytes = await readFile(file)
        res.writeHead(200, { 'content-type': avatarInfo(root).mime, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
        return res.end(bytes)
      }
      if (route === 'wake' && req.method === 'POST') {
        try {
          const status = await wake?.((await body(req)).id)
          return send(res, status ? 200 : 409, status ? { status } : { error: '微信接入未就绪' })
        } catch (error) { return send(res, 400, { error: error.message }) }
      }
      if (route.startsWith('wechat/')) {
        const api = admin()
        if (!api) return send(res, 409, { error: '请在 DSH profile 中启用 Fish 的 wechat 接入' })
        try {
          if (route === 'wechat/relationships' && req.method === 'GET') return send(res, 200, api.relationships())
          if (route === 'wechat/relationships' && req.method === 'POST') return send(res, 200, await api.changeRelationship(await body(req)))
          if (route === 'wechat/father' && req.method === 'GET') return send(res,200,{father:api.father()})
          if (route === 'wechat/father' && req.method === 'POST') return send(res,200,await api.setFather(await body(req)))
          if (route === 'wechat/settings' && req.method === 'GET') return send(res, 200, await api.info())
          if (route === 'wechat/settings' && req.method === 'POST') return send(res, 200, await api.save(await body(req, 65536)))
          if (route === 'wechat/detect' && req.method === 'POST') {
            const { kind, row } = await body(req)
            return send(res, 200, await api.detect(kind, row))
          }
          if (route === 'wechat/login' && req.method === 'POST') return send(res, 200, await api.startLogin())
          if (route === 'wechat/login' && req.method === 'GET') return send(res, 200, await api.pollLogin())
          if (route === 'wechat/qr' && req.method === 'GET') {
            const bytes = await api.qr(Number(url.searchParams.get('generation')))
            res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' })
            return res.end(bytes)
          }
        } catch (error) {
          return send(res, 400, { error: error.code ? 'Native：' + error.code : error.message })
        }
      }
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
          if (native) transport = { ...native.status(), ...native.identity(), groups: native.authorizedGroups(), contacts: native.config?.contacts || [] }
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
        return send(res, 200, { events: events.filter((e) => !['seed','seed_revision'].includes(e.type)).slice(-80) })
      }
      if (req.method === 'GET' && route === 'backup')
        return send(res, 200, await collectBackup(root))
      return send(res, 404, { error: 'Unknown route' })
    } catch {
      return send(res, 500, { error: 'Operation failed; check private service logs' })
    }
  }
  const off = server?.register?.({ kind: 'prefix', path: '/dsh-fish', handler })
  return {
    dispose() {
      if (typeof off === 'function') off()
      else off?.dispose?.()
    },
  }
}
