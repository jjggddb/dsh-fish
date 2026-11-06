import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { changeGallery, listGallery, migrateGallery, galleryBytes, visibleImage } from '../lib/gallery.js'
import { accessible } from '../lib/gallery-tools.js'
import { gateway } from '../tools/xhs-gateway.mjs'

const bytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l0cAAAAASUVORK5CYII=',
  'base64',
)
async function temp(t) {
  const root = await mkdtemp(join(tmpdir(), 'fish-gallery-'))
  t.after(() => rm(root, { force: true, recursive: true }))
  return root
}
test('migration including disabled stickers and their original notes is stable across two starts', async (t) => {
  const root = await temp(t),
    id = '78c32e44-9189-471c-914b-ebdbe4c35944'
  const row = {
    id,
    description: '大笑 ｜ 老备注',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    enabled: false,
    mime: 'image/png',
  }
  const old = join(root, 'stickers')
  await mkdir(old)
  await writeFile(join(old, id + '.png'), bytes)
  await writeFile(join(old, 'index.json'), JSON.stringify([row]))
  migrateGallery(root)
  migrateGallery(root)
  assert.deepEqual(listGallery(root), [row])
  assert.deepEqual(await galleryBytes(root, row), bytes)
  assert.deepEqual(await readdir(root), ['gallery'])
})
test('WeChat files stay in the source unless Fish chooses reuse, public gallery obeys account/type/blacklist and deletion', async (t) => {
  const root = await temp(t)
  const wx = { scene: 'group', accountId: 'a', groupId: 'room' },
    other = { ...wx, groupId: 'other' }
  const source = { kind: 'wechat', accountId: 'a', threadId: 'room' }
  const save = (source, scope) =>
    changeGallery(root, { action: 'upload', bytes, description: '海豹' }, { source, scope })
  const first = await save(source, wx)
  assert.equal((await save(source, wx)).id, first.id)
  assert(!visibleImage(first, other))
  assert(!visibleImage(first, { scene: 'xhs', accountId: 'fish', wechatAccountId: 'a' }))
  const shared = await save({ ...source, reuse: 'collection' }, wx)
  assert(visibleImage(shared, other))
  assert(visibleImage(shared, { scene: 'xhs', accountId: 'fish', wechatAccountId: 'a' }))
  assert(!visibleImage(shared, { ...other, accountId: 'b' }))
  const xhs = { scene: 'xhs', accountId: 'fish' }
  const pic = await save({ kind: 'xhs', accountId: 'fish', type: 'image', title: '画册' }, xhs)
  assert(accessible(pic, wx, { accountId: 'fish', allowedTypes: ['image'], blockedWords: [] }))
  for (const policy of [
    { accountId: 'other', allowedTypes: ['image'] },
    { accountId: 'fish', allowedTypes: ['text'] },
    { accountId: 'fish', allowedTypes: ['image'], blockedWords: ['画册'] },
  ])
    assert(!accessible(pic, wx, policy))
  await changeGallery(root, { action: 'delete', id: pic.id }, { scope: xhs })
  assert(!listGallery(root).some((i) => i.id === pic.id))
  await assert.rejects(galleryBytes(root, pic), { code: 'ENOENT' })
})
async function listen(t, server) {
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
  t.after(() => {
    server.closeAllConnections()
    return new Promise((ok) => server.close(ok))
  })
  return 'http://127.0.0.1:' + server.address().port
}
test('gateway supplies local gallery bytes to publish, cleans temporary files and rejects arbitrary paths and non-platform media', async (t) => {
  const exchange = await temp(t)
  let calls = 0
  const upstream = await listen(
    t,
    createServer(async (req, res) => {
      assert.equal(req.url, '/api/v1/publish')
      assert.equal(req.headers.authorization, 'Bearer test')
      let text = ''
      for await (const chunk of req) text += chunk
      const body = JSON.parse(text)
      calls++
      assert.equal(body.images.length, 1)
      assert(body.images[0].startsWith(exchange + '/post-'))
      assert.deepEqual(await readFile(body.images[0]), bytes)
      res.end(JSON.stringify({ success: true, data: { status: '发布完成', title: body.title, images: 1 } }))
    }),
  )
  const url = await listen(t, gateway({ exchange, upstream, token: 'test' }))
  const post = (path, body) => fetch(url + '/api/v1/' + path, { method: 'POST', body: JSON.stringify(body) })
  assert.equal((await post('publish', { images: ['/some/file'] })).status, 403)
  assert.equal((await post('fish/media', { url: 'http://127.0.0.1/local', kind: 'image' })).status, 400)
  assert.equal((await post('fish/link', { url: 'https://xiaohongshu.com.invalid/a' })).status, 400)
  const link = await (
    await post('fish/link', { url: 'https://www.xiaohongshu.com/explore/post?xsec_token=handle' })
  ).json()
  assert.deepEqual(link.data, { feedId: 'post', token: 'handle' })
  const response = await post('fish/publish', {
    title: '海豹',
    content: '今天看到的',
    images: [{ mime: 'image/png', data: bytes.toString('base64') }],
  })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).data.status, '发布完成')
  assert.equal(calls, 1)
  assert.deepEqual(await readdir(exchange), [])
})
