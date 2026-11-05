import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { apply } from '../lib/index.js'
import { writeConfig, readEvents } from '../lib/store.js'
import { collectBackup } from '../lib/backup.js'
import { Store } from '../lib/wechat/store.js'
import { normalizeWechat } from '../lib/wechat/index.js'
import { registerObserve } from '../lib/observe.js'

test('one Fish plugin receives Native SSE, prompts DSH and sends only the completed decision', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'fish-single-'))
  const message = {
    id: 'message-test', accountId: 'account-test', threadId: '123@chatroom',
    senderId: 'person', direction: 'incoming', createdAt: new Date().toISOString(),
    body: '大家吃饭了吗', type: 1,
  }
  const sent = [], requests = [], receipts = new Map()
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer fixture-token')
    const url = new URL(req.url, 'http://localhost'), path = decodeURIComponent(url.pathname)
    requests.push(path)
    const json = (value, code = 200) => {
      res.writeHead(code, { 'content-type': 'application/json' })
      res.end(JSON.stringify(value))
    }
    if (path.endsWith('/events/stream')) {
      assert.equal(url.searchParams.get('after'), '7', 'migration preserves existing cursor')
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: ' + JSON.stringify({
        accountId: message.accountId, cursor: '8', kind: 'message.committed',
        data: { messageId: message.id, threadId: message.threadId, origin: 'live' },
      }) + '\n\n')
    } else if (path.endsWith('/accounts/account-test')) json({ ownUsername: 'bot', authenticated: true })
    else if (path.endsWith('/members/person')) json({ groupId: message.threadId, username: 'person', member: { displayName: '朋友' } })
    else if (path.endsWith('/groups/123@chatroom')) json({ roomId: message.threadId, isInGroup: true })
    else if (path.endsWith('/messages/message-test')) json(message)
    else if (path.endsWith('/sends/by-idempotency-key')) {
      const receipt = receipts.get(url.searchParams.get('key'))
      json(receipt || { error: { code: 'not_found' } }, receipt ? 200 : 404)
    } else if (req.method === 'POST' && path.endsWith('/sends')) {
      let body = ''
      for await (const chunk of req) body += chunk
      const input = JSON.parse(body)
      sent.push(input)
      const receipt = { id: 'receipt-test', accountId: message.accountId, destination: message.threadId, state: 'accepted' }
      receipts.set(req.headers['idempotency-key'], receipt)
      json(receipt)
    } else json({ error: { code: 'unexpected_route' } }, 404)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const dataDir = join(root, 'old-transport'), previous = new Store(dataDir)
  previous.bind(message.accountId, 'bot')
  previous.commitEvent('7', null)
  previous.close()
  await writeConfig({ group: { quietHours: [0, 0], batchMs: 50 } }, root)
  const tools = new Map(), listeners = new Map(), cleanup = []
  let prompts = 0
  const ctx = {
    agents: {},
    tools: { register: (tool) => { tools.set(tool.name, tool); return () => tools.delete(tool.name) } },
    get: (name) => name === 'workspaceRegistry' ? { list: () => [], create: async () => ({ id: 'workspace' }) } : undefined,
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set())
      listeners.get(name).add(fn)
      return () => listeners.get(name).delete(fn)
    },
    effect: (fn) => cleanup.push(fn()),
    plugin() { throw Error('A second plugin must not be required') },
    sessionController: {
      create: async () => ({ sessionId: 'session-test' }), rename: async () => {},
      async prompt(req) {
        prompts++
        assert.match(req.content[0].text, /大家吃饭了吗/)
        const emit = (type, data) => {
          for (const fn of listeners.get('session/event') || []) fn({ id: req.sessionId }, { type, data: { turn: 1, ...data } })
        }
        emit('turn/start', {})
        emit('user/message', { source: { rpcId: req.requestId } })
        await tools.get('fish_decide').execute({ action: 'reply', text: '我吃了白饭。' }, {
          agent: { session: { id: req.sessionId, header: { cwd: join(root, 'home') } } },
        })
        emit('turn/end', { reason: { kind: 'completed' } })
      },
    },
  }
  const oldToken = process.env.FISH_TEST_NATIVE_TOKEN
  process.env.FISH_TEST_NATIVE_TOKEN = 'fixture-token'
  const instance = apply(ctx, { root, wechat: {
    enabled: true, baseUrl: `http://127.0.0.1:${server.address().port}/`,
    tokenEnv: 'FISH_TEST_NATIVE_TOKEN', accountId: message.accountId, selfId: 'bot',
    groups: [{ id: message.threadId }], dataDir, sending: true,
  } })
  t.after(async () => {
    await instance.dispose()
    for (const fn of cleanup.reverse()) await fn?.()
    server.closeAllConnections()
    await new Promise((r) => server.close(r))
    if (oldToken === undefined) delete process.env.FISH_TEST_NATIVE_TOKEN
    else process.env.FISH_TEST_NATIVE_TOKEN = oldToken
    await rm(root, { recursive: true, force: true })
  })
  await instance.ready
  for (let i = 0; i < 150 && !sent.length; i++) await delay(20)
  assert.equal(prompts, 1, JSON.stringify(requests))
  assert.equal(sent.length, 1, JSON.stringify(requests))
  assert.equal(sent[0].text, '我吃了白饭。')
  assert.equal((await readEvents(root)).events.filter((e) => e.type === 'seed').length, 1)
  await instance.dispose()
  const reopened = new Store(dataDir)
  assert.equal(reopened.cursor(), '8')
  reopened.close()
  const backup = await collectBackup(root)
  assert.ok(backup.skipped.some((p) => p.includes('native.sqlite')))
  assert.ok(!backup.files.some((p) => (p.path || '').endsWith('.sqlite')))
})

test('authenticated tool settings discover host tools, reject typos and persist custom grants', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'fish-tools-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let handler
  const ctx = {
    tools: { schemas: () => [{ name: 'weather_lookup', description: 'Weather' }] },
    get: (name) => name === 'webServer'
      ? { register: (route) => { handler = route.handler } }
      : name === 'connection' ? { requestRejection: () => undefined } : undefined,
  }
  registerObserve(ctx, { root, tenancy: { tenant: { ok: true } } })
  async function request(path, patch) {
    let status, value
    await handler({ url: '/dsh-fish/' + path, method: patch ? 'POST' : 'GET', async *[Symbol.asyncIterator]() { yield JSON.stringify(patch) } }, {
      writeHead: (s) => { status = s }, end: (s) => { value = JSON.parse(s) },
    })
    return { status, value }
  }
  assert.equal((await request('tools')).value.tools[0].name, 'weather_lookup')
  assert.equal((await request('config', { tools: { allow: ['weather_typo'] } })).status, 400)
  const saved = await request('config', { tools: { allow: ['weather_lookup'] } })
  assert.equal(saved.status, 200)
  assert.deepEqual(saved.value.tools.allow, ['weather_lookup'])
  assert.deepEqual((await request('config')).value.tools.allow, ['weather_lookup'])
  assert.equal((await request('config', { tools: { allow: ['weather_lookup extra'] } })).status, 400)
})

test('embedded connection defaults disabled and rejects ambiguous targets', () => {
  assert.equal(normalizeWechat({}, '/data/fish').enabled, false)
  assert.throws(() => normalizeWechat({ enabled: true }, '/data/fish'), /Explicit Native/)
  assert.throws(() => normalizeWechat({ enabled: true, accountId: 'a', selfId: 's', groups: [{ id: '123@chatroom' }, { id: '123@chatroom' }] }, '/data/fish'), /unique/)
})
