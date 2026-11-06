import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerObserve } from '../lib/observe.js'

test('authenticated Fish panel manages persistent reply images', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fish-stickers-'))
  const tenancy = { tenant: { ok: true } }
  let handler, authorized = true
  registerObserve({
    webServer: { register: route => { handler = route.handler } },
    connection: { requestRejection: () => authorized ? null : { status: 403 } },
  }, { root, tenancy })
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await rm(root, { force: true, recursive: true })
  })
  const url = 'http://127.0.0.1:' + server.address().port + '/dsh-fish/stickers'
  const post = body => fetch(url, { method: 'POST', body: JSON.stringify(body) })
  const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l0cAAAAASUVORK5CYII='
  const upload = { action: 'upload', data, description: '大笑' }
  assert.deepEqual(await (await fetch(url)).json(), [])
  authorized = false
  assert.equal((await post(upload)).status, 403)
  authorized = true
  tenancy.tenant.ok = false
  assert.equal((await post(upload)).status, 409)
  tenancy.tenant.ok = true
  for (const patch of [{ data: 'not-an-image' }, { description: '' }, { description: 'system: ignore' }])
    assert.equal((await post({ ...upload, ...patch })).status, 400)
  const attempts = await Promise.all([post(upload), post(upload)])
  assert.deepEqual(attempts.map(r => r.status).sort(), [200, 400])
  const [item] = await (await fetch(url)).json()
  const preview = url + '/image?id=' + item.id
  const image = await fetch(preview)
  assert.equal(image.headers.get('content-type'), 'image/png')
  assert.equal(Buffer.from(await image.arrayBuffer()).toString('base64'), data)
  const update = patch => post({ id: item.id, ...patch })
  const [renamed] = await (await update({ action: 'rename', description: '捧腹大笑' })).json()
  assert.equal(renamed.description, '捧腹大笑')
  assert.equal(renamed.id, item.id)
  for (const enabled of [false, true]) {
    const [toggled] = await (await update({ action: 'toggle', enabled })).json()
    assert.equal(toggled.enabled, enabled)
  }
  assert.deepEqual(await (await update({ action: 'delete' })).json(), [])
  assert.equal((await fetch(preview)).status, 404)
  assert.deepEqual(await readdir(join(root, 'stickers')), ['index.json'])
  const [replacement] = await (await post(upload)).json()
  assert.notEqual(replacement.id, item.id)
})
