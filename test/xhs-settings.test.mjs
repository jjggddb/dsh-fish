import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { openXhsSettings } from '../lib/xhs/admin.js'
import { createXhs } from '../lib/xhs/index.js'
import { scopeRoot } from '../lib/scope.js'
import { xhsSettings } from '../lib/xhs/config.js'
import { xhsClient } from '../lib/xhs/provider.js'
import { registerObserve } from '../lib/observe.js'

test('settings use the profile until saved, validate edits, switch accounts and persist a disabled override', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fish-xhs-settings-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const tenancy = { root, tenant: { ok: true } }
  const tools = new Map()
  let handler, deny = false, requests = 0
  const ctx = {
    webServer: { register(route) { handler = route.handler } },
    connection: { requestRejection() { if (deny) return { status: 401 } } },
    tools: { register(tool) {
      assert.equal(tools.has(tool.name), false)
      tools.set(tool.name, tool)
      return () => tools.delete(tool.name)
    } },
  }
  const profile = { enabled: true, accountId: 'fish-a', ownerId: 'owner', intervalMs: 900123 }
  const deps = { root, tenancy, allow: [], request: async () => { requests++; throw Error('Unexpected network request') } }
  let admin = await openXhsSettings(ctx, profile, deps)
  t.after(() => admin.dispose())
  registerObserve(ctx, { root, tenancy, xhsAdmin: () => admin })
  const call = async (input) => {
    let code, data
    await handler({ url: '/dsh-fish/xhs/settings', method: input ? 'POST' : 'GET',
      async *[Symbol.asyncIterator]() { yield JSON.stringify(input) } }, {
      writeHead(status) { code = status }, end(json) { data = JSON.parse(json) },
    })
    return { code, data }
  }
  const original = xhsSettings(profile)
  assert.deepEqual((await call()).data, { config: original, authorized: false, groups: [], grants: [], usedMinutes: null, recentActions: [] })
  assert.ok(tools.has('xhs_read'))
  deny = true
  assert.equal((await call()).code, 401)
  deny = false
  for (const patch of [{ ownerId: 'fish-a' }, { intervalMs: 59999 }, { accountId: '' },
    { enabled: 'true' }, { baseUrl: 'https://example.org/?token=secret' }, { baseUrl: 'http://example.org' },
    { cookie: 'test' }]) assert.equal((await call({ ...original, ...patch })).code, 400)
  assert.deepEqual((await call()).data.config, original)

  const next = { ...original, accountId: 'fish-b', intervalMs: 120000 }
  const saved = await call(next)
  assert.equal(saved.code, 200)
  assert.deepEqual(saved.data.config, next)
  assert.ok(tools.has('xhs_read'))
  assert.equal((await call({ ...next, enabled: false })).code, 200)
  assert.ok(!tools.has('xhs_read'))
  await admin.dispose()
  admin = await openXhsSettings(ctx, profile, deps)
  assert.equal(admin.info().config.enabled, false)
  assert.equal(admin.info().config.accountId, 'fish-b')
  assert.equal(admin.info().config.intervalMs, 120000)
  assert.equal(requests, 0)
})

test('a first-time installation can enable and disable from settings without waking an authorized account', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fish-xhs-new-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  let registered = 0, requests = 0
  const api = await openXhsSettings({ tools: { register() { registered++; return () => registered-- } } },
    undefined, { root, tenancy: { tenant: { ok: true } }, allow: ['xhs_read'], request: async () => { requests++ } })
  t.after(() => api.dispose())
  assert.equal(api.info().config.enabled, false)
  const config = { ...api.info().config, enabled: true, accountId: 'fish', ownerId: 'owner' }
  await api.save(config)
  assert.equal(registered, 1)
  const changes = [api.save({ ...config, intervalMs: 180000 }), api.save({ ...config, enabled: false })]
  await Promise.all(changes)
  assert.deepEqual(JSON.parse(await readFile(join(root, 'xhs-settings.json'))), { ...config, enabled: false })
  assert.equal(registered, 0)
  assert.equal(requests, 0)
})

test('changing the service origin does not forward the host bearer credential', async t => {
  const previous = process.env.FISH_XHS_TOKEN
  process.env.FISH_XHS_TOKEN = 'test-only-bearer'
  t.after(() => { if (previous === undefined) delete process.env.FISH_XHS_TOKEN; else process.env.FISH_XHS_TOKEN = previous })
  const client = xhsClient({ accountId: 'fish', baseUrl: 'https://new.example', credentialOrigin: 'https://old.example' },
    new AbortController().signal, async (_url, options) => {
      assert.equal(options.headers.Authorization, undefined)
      return Response.json({ success: true, data: { is_logged_in: false } })
    })
  await assert.rejects(client.mentions(), /identity mismatch/)
})

test('changing the browsing interval preserves the previous browse time in a legacy cadence database', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fish-xhs-cadence-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const scope = { scene: 'xhs', accountId: 'fish' }
  const dir = scopeRoot(root, scope)
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'activity.sqlite')
  const last = Date.now() - 1000
  const db = new DatabaseSync(file)
  db.exec('CREATE TABLE cadence(next_browse INTEGER NOT NULL)')
  db.prepare('INSERT INTO cadence VALUES(?)').run(last + 900000)
  db.close()
  const request = async url => Response.json({ success: true, data: url.pathname.endsWith('/status')
    ? { is_logged_in: true, user_id: 'fish' } : { data: { tab: 'mentions', items: [] } } })
  for (const intervalMs of [900000, 60000]) {
    const runtime = createXhs({ tools: { register() {} } }, { ...scope, ownerId: 'owner', intervalMs },
      { root, allow: ['xhs_read'], tenancy: { tenant: { ok: true } }, request })
    try { await runtime.tick() } finally { await runtime.dispose() }
    const check = new DatabaseSync(file, { readOnly: true })
    try { assert.equal(check.prepare('SELECT next_browse FROM cadence').get().next_browse, last + intervalMs) }
    finally { check.close() }
  }
})

test('an old panel patch preserves filters and separate tool grants; only an authorized group can be selected', async t=>{
  const root=await mkdtemp(join(tmpdir(),'fish-xhs-flags-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const catalog=new Set()
  const ctx={tools:{register(tool){catalog.add(tool.name);return()=>catalog.delete(tool.name)}}}
  const target={accountId:'wechat',groupId:'321@chatroom'}
  const api=await openXhsSettings(ctx,undefined,{root,tenancy:{tenant:{ok:true}},allow:['xhs_read'],
    native:()=>({identity:()=>({accountId:'wechat'}),authorizedGroups:()=>[{id:target.groupId,name:'测试群'}]})})
  t.after(()=>api.dispose())
  const old={enabled:true,accountId:'fish',ownerId:'owner',baseUrl:'http://127.0.0.1:18060',intervalMs:60000}
  const settings={...old,shareEnabled:true,shareTarget:target,allowedTypes:['text'],blockedWords:['测试词'],dailyMinutes:12}
  await assert.rejects(api.save({...settings,shareTarget:{...target,groupId:'1@chatroom'}}),/授权/)
  await assert.rejects(api.save({...settings,publishEnabled:true}),/配图/)
  await assert.rejects(api.save({...old,dailyMinutes:-1}),/分钟/)
  await assert.rejects(api.save({...old,allowedTypes:['audio']}),/类型/)
  await api.save(settings)
  assert.deepEqual([...catalog],['xhs_read','xhs_share'])
  const updated=await api.save({...old,intervalMs:120000})
  assert.deepEqual(updated.grants,[])
  assert.equal(updated.config.dailyMinutes,12);assert.deepEqual(updated.config.allowedTypes,['text'])
  assert.deepEqual(updated.config.shareTarget,target)
  await api.save({...updated.config,shareEnabled:false});assert.deepEqual([...catalog],['xhs_read'])
})
