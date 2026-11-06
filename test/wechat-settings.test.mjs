import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { wechatAdmin } from '../lib/wechat/admin.js'
import { NativeTransport } from '../lib/wechat/transport.js'
import { Store } from '../lib/wechat/store.js'
import { visibleEvents, scopeRoot, provenance } from '../lib/scope.js'
import { bucketOf } from '../lib/talkmem.js'
import { settingsState } from '../lib/settings-view.js'
import { appendEvent } from '../lib/store.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'fish-settings-'))
  const db = new Store(root)
  t.after(async () => {
    db.close()
    await rm(root, { recursive: true, force: true })
  })
  const config = {
    accountId: 'test',
    selfId: 'bot',
    groups: [],
    contacts: [],
    maxMessageAgeMs: 300000,
  }
  const client = {
    account: async () => ({ authenticated: true, ownUsername: 'bot' }),
    contact: async (_account, id) => ({ username: id, remark: '朋友' }),
    group: async (_account, id) => ({ roomId: id, displayName: '群' }),
  }
  const create = () =>
    new NativeTransport({
      store: db,
      client,
      config: { ...config },
      signal: new AbortController().signal,
    })
  const native = create()
  return { root, client, native, db, admin: wechatAdmin(native), create }
}
test('saved target lists admit only the named peer and revoke pending sends, including across restarts', async (t) => {
  const { admin, client, native, create, db } = await fixture(t)
  await native.verify()
  assert.deepEqual(await admin.detect('contacts', { id: 'friend' }), { id: 'friend', name: '朋友' })
  const lists = { groups: [{ id: '123@chatroom' }], contacts: [{ id: 'friend' }], sending: true }
  await admin.save(lists)
  const restored = create()
  await restored.verify()
  assert.equal(restored.sending, true)
  assert.equal(restored.permits('friend'), true)
  assert.equal(restored.permits('stranger'), false)
  assert.equal(restored.scene('friend'), 'private')
  const msg = {
    id: 'm',
    threadId: 'friend',
    accountId: 'test',
    senderId: 'friend',
    direction: 'incoming',
    createdAt: new Date().toISOString(),
  }
  client.message = async () => msg
  const event = (cursor) => ({
    kind: 'message.committed',
    cursor,
    data: { threadId: 'friend', messageId: msg.id, origin: 'live' },
  })
  msg.senderId = 'stranger'
  await native.ingest(event('1'))
  assert.equal(db.message('m'), null)
  msg.senderId = 'friend'
  await native.ingest(event('2'))
  assert.equal(db.message('m').senderId, 'friend')
  await assert.rejects(native.sendText('m', 'hi', { mentions: ['friend'] }), /group/)
  await admin.save({ groups: [], contacts: [] })
  await assert.rejects(native.sendText('m', 'hi'), /authorized source/)
  assert.deepEqual((await admin.info()).contacts, [])
  await assert.rejects(admin.save({ groups: [], contacts: [{ id: 'x' }, { id: 'x' }] }), /重复/)
  client.contact = async () => ({ username: 'other' })
  await assert.rejects(admin.detect('contacts', { id: 'friend' }), /身份/)
})
test('QR login resumes one Native operation, uses the current PNG generation, and leaves an online account alone', async (t) => {
  const { admin, native, client } = await fixture(t)
  let logged = false,
    starts = 0,
    generation = 1,
    state = 'awaiting_scan'
  client.account = async () => ({ authenticated: logged, ownUsername: 'bot' })
  function op() {
    return {
      id: 'op' + starts,
      kind: 'login',
      accountId: 'test',
      state,
      result: { qrGeneration: generation, qrAvailable: state === 'awaiting_scan' },
    }
  }
  client.login = async (_, opts) => {
    assert.equal(opts.strategy, 'qr')
    starts++
    state = 'awaiting_scan'
    return op()
  }
  client.operation = async () => op()
  client.qr = async (_a, id, g) => {
    assert.equal(id, 'op1')
    assert.equal(g, 2)
    return Buffer.from('png')
  }
  await Promise.all([admin.startLogin(), admin.startLogin()])
  assert.equal(starts, 1)
  const resumed = wechatAdmin(native)
  await resumed.startLogin()
  assert.equal(starts, 1)
  generation = 2
  await assert.rejects(resumed.qr(1), /更新/)
  assert.equal((await resumed.qr(2)).toString(), 'png')
  state = 'expired'
  await resumed.startLogin()
  assert.equal(starts, 2)
  logged = true
  assert.equal((await resumed.startLogin()).state, 'authenticated')
  assert.equal(starts, 2)
})
test('private memory, diary and recent exchanges stay separate from every group, contact and desktop', () => {
  const scope = { scene: 'private', accountId: 'a', groupId: 'friend', personId: 'friend' }
  const event = { ...provenance(scope), type: 'utterance', text: '私聊内容' }
  assert.equal(event.groupId, undefined)
  assert.deepEqual(visibleEvents([event], scope), [event])
  for (const other of [
    { ...scope, accountId: 'b' },
    { ...scope, groupId: 'other' },
    { ...scope, scene: 'group' },
    { scene: 'desk' },
  ]) {
    assert.deepEqual(visibleEvents([event], other), [])
    assert.notEqual(scopeRoot('/root', scope), scopeRoot('/root', other))
  }
  assert.notEqual(
    bucketOf('private', 'wechat-private:friend'),
    bucketOf('private', 'wechat-private:other'),
  )
  assert.notEqual(bucketOf('private', 'wechat-private:friend'), bucketOf('desk'))
})
test('original growth summary computes real event counts and diagnostics for the settings page', async (t) => {
  const { root } = await fixture(t)
  await appendEvent(
    { type: 'seed', text: '我喜欢早晨。' },
    { day: 1, stage: 1, source: 'system' },
    root,
  )
  await appendEvent(
    { type: 'utterance', text: '我最近喜欢白饭。' },
    { day: 1, stage: 1, source: 'tool' },
    root,
  )
  const s = await settingsState(root)
  assert.equal(s.counts.real, 2)
  assert.equal(s.counts.utterance, 1)
  assert.equal(s.beliefs.length, 1)
  assert.equal(s.stageName, '信任')
  assert.ok(s.quality.stability.band)
  assert.equal(s.avatar.present, false)
})

test('name detection reads all pages, prompts for duplicate names, and resolves contact remarks',async(t)=>{
  const {client,admin}=await fixture(t)
  client.groups=async(_account,opts)=>opts.cursor
    ? {items:[{id:'2@chatroom',roomId:'2@chatroom',name:'读书群'}],nextCursor:null}
    : {items:[{roomId:'1@chatroom',displayName:'读书群'},{roomId:'3@chatroom',displayName:'读书群二'}],nextCursor:'page2'}
  client.group=async(_a,id)=>({roomId:id,displayName:'读书群',remark:id==='1@chatroom'?'周末组':'周三组'})
  const ambiguous=await admin.detect('groups',{name:'读书群'})
  assert.deepEqual(ambiguous.candidates.map(x=>x.id),['1@chatroom','2@chatroom'])
  client.contacts=async()=>({items:[{username:'friend',remark:'小林',nickname:'林同学'},{deleted:true,id:'removed'}],nextCursor:null})
  assert.equal((await admin.detect('contacts',{name:'小林'})).id,'friend')
  await assert.rejects(admin.detect('contacts',{name:'林'}),/没有找到/)
})

test('one host seed correction reaches growth and Agent without rewriting historical bytes',async(t)=>{
  const {root}=await fixture(t)
  const {readFile}=await import('node:fs/promises')
  const {identityFor}=await import('../lib/selfdoc.js')
  const old=await appendEvent({type:'seed',text:'我来自一个QQ群。'},{source:'system'},root)
  const before=await readFile(join(root,'events.jsonl'),'utf8')
  await assert.rejects(appendEvent({type:'seed_revision',text:'其他',refs:[old.id]},{source:'tool'},root))
  await assert.rejects(appendEvent({type:'seed_revision',text:'其他',refs:['invalid']},{source:'system'},root))
  await appendEvent({type:'seed_revision',text:'我来自一个微信群。',refs:[old.id]},{source:'system'},root)
  assert.equal((await settingsState(root)).seed,'我来自一个微信群。')
  const prompt=await identityFor(root,{scene:'group',groupId:'test',accountId:'a'})
  assert.match(prompt,/一个微信群/);assert.doesNotMatch(prompt,/QQ群/)
  assert.ok((await readFile(join(root,'events.jsonl'),'utf8')).startsWith(before))
})
