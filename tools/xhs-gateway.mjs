// Private Unix-socket adapter for the separate xiaohongshu-mcp browser service.
import http from 'node:http'
import { chmod, chown, mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const MiB = 1024 * 1024
const routes = new Set([
  'GET login/status',
  'POST notifications/list',
  'GET feeds/list',
  'POST feeds/search',
  'POST feeds/detail',
  'POST feeds/comment',
  'POST feeds/comment/reply',
])
function checkedUrl(value, domains) {
  const url = new URL(value)
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.port ||
    url.username ||
    url.password ||
    !domains.some((d) => url.hostname === d || url.hostname.endsWith('.' + d))
  )
    throw Error('Invalid origin')
  url.protocol = 'https:'
  return url
}
async function limited(stream, maximum) {
  const chunks = []
  let length = 0
  for await (const chunk of stream) {
    length += chunk.length
    if (length > maximum) throw Error('Media too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
async function follow(value, domains, signal, link = false) {
  let url = checkedUrl(value, domains)
  for (let i = 0; i < 5; i++) {
    if (link && /(?:^|\.)xiaohongshu\.com$/.test(url.hostname)) {
      const match = /^\/(?:explore|discovery\/item)\/([A-Za-z0-9_-]{1,128})\/?$/.exec(url.pathname)
      if (match) return { feedId: match[1], token: url.searchParams.get('xsec_token') || '' }
    }
    const res = await fetch(url, { redirect: 'manual', signal, headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (res.status >= 300 && res.status < 400 && res.headers.has('location')) {
      const next = new URL(res.headers.get('location'), url)
      await res.body?.cancel()
      url = checkedUrl(next, domains)
      continue
    }
    if (link || !res.ok) {
      await res.body?.cancel()
      throw Error('Unavailable')
    }
    return res
  }
  throw Error('Redirect limit')
}
export function gateway({
  exchange = '/fish-media-exchange',
  upstream = 'http://127.0.0.1:18060',
  token = process.env.AUTH_TOKEN,
} = {}) {
  const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + token }
  async function proxy(path, body, signal) {
    const response = await fetch(upstream + '/api/v1/' + path, {
      method: body ? 'POST' : 'GET',
      headers,
      body: body && JSON.stringify(body),
      redirect: 'error',
      signal,
    })
    return { status: response.status, data: JSON.parse((await limited(response.body, 12 * MiB)).toString()) }
  }
  return http.createServer(async (req, res) => {
    const path = req.url?.replace(/^\/api\/v1\//, '')
    const abort = new AbortController()
    res.once('close', () => {
      if (!res.writableEnded) abort.abort()
    })
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(110000)])
    let status = 400,
      data
    try {
      const post = req.method === 'POST'
      if (
        !req.url.startsWith('/api/v1/') ||
        !(
          routes.has(req.method + ' ' + path) ||
          (post && ['fish/media', 'fish/link', 'fish/publish'].includes(path))
        )
      ) {
        res.writeHead(403)
        res.end()
        return
      }
      const body = post
        ? JSON.parse((await limited(req, path === 'fish/publish' ? 32 * MiB : 128 * 1024)).toString())
        : undefined
      if (path === 'fish/media') {
        const limit = { image: 10 * MiB, video: 32 * MiB, subtitle: 512 * 1024 }[body.kind]
        if (!limit) throw Error('Invalid media kind')
        const r = await follow(body.url, ['xhscdn.com'], signal)
        const bytes = await limited(r.body, limit)
        data = { success: true, data: { base64: bytes.toString('base64') } }
        status = 200
      } else if (path === 'fish/link') {
        data = {
          success: true,
          data: await follow(body.url, ['xiaohongshu.com', 'xhslink.com'], signal, true),
        }
        status = 200
      } else if (path === 'fish/publish') {
        if (
          !Array.isArray(body.images) ||
          !body.images.length ||
          body.images.length > 18 ||
          typeof body.title !== 'string' ||
          typeof body.content !== 'string'
        )
          throw Error('Invalid note')
        await mkdir(exchange, { recursive: true })
        const dir = await mkdtemp(join(exchange, 'post-'))
        try {
          await chmod(dir, 0o755)
          const files = []
          for (const [i, img] of body.images.entries()) {
            const ext = { 'image/jpeg': 'jpg', 'image/png': 'png' }[img?.mime]
            if (!ext || typeof img.data !== 'string') throw Error('Invalid upload')
            const bytes = Buffer.from(img.data, 'base64')
            if (!bytes.length || bytes.length > 4 * MiB || bytes.toString('base64') !== img.data)
              throw Error('Invalid upload')
            const path = join(dir, i + '.' + ext)
            await writeFile(path, bytes, { mode: 0o644 })
            files.push(path)
          }
          ;({ status, data } = await proxy(
            'publish',
            { title: body.title, content: body.content, images: files },
            signal,
          ))
        } finally {
          await rm(dir, { recursive: true, force: true })
        }
      } else ({ status, data } = await proxy(path, body, signal))
    } catch {
      data = { success: false, error: 'Request unavailable' }
    }
    if (!res.destroyed) {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(data))
    }
  })
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const socket = '/run/xhs-read/reader.sock'
  await unlink(socket).catch((e) => {
    if (e.code !== 'ENOENT') throw e
  })
  gateway().listen(socket, async () => {
    await chown(socket, 1101, 1101)
    await chmod(socket, 0o600)
  })
}
