import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Store } from '../lib/wechat/store.js'
import { NativeTransport } from '../lib/wechat/transport.js'
import { createReminders, reminderIntent, reminderDecision, REMINDER_TOOL } from '../lib/reminders.js'
import { effectiveTools } from '../lib/restrict.js'
import { writeConfig } from '../lib/store.js'

const room = '1@chatroom'
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'fish-reminder-')),
    db = new Store(join(root, 'wechat'))
  await writeConfig({ tools: { allow: [REMINDER_TOOL] } }, root)
  const records = [],
    changes = new Set(),
    receipts = new Map(),
    sent = []
  const notify = () => {
    for (const fn of changes) fn()
  }
  let nextTask = 0
  const host = {
    catalog: async () => records.map((r) => ({ ...r })),
    async create(sessionId, { title, prompt, at }) {
      const r = {
        id: 'task-' + ++nextTask,
        kind: 'at',
        title,
        prompt,
        scheduledAt: at,
        status: 'active',
        sessionId,
      }
      records.push(r)
      notify()
      return { ...r }
    },
    async update({ id, sessionId, change, title, expected }) {
      const r = records.find((x) => x.id === id && x.sessionId === sessionId && x.status === 'active')
      if (!r || r.scheduledAt !== expected.scheduledAt) return { updated: false }
      if (change) r.scheduledAt = change.at
      if (title) r.title = title
      notify()
      return { updated: true, record: { ...r } }
    },
    async delete({ id, sessionId }) {
      const i = records.findIndex((x) => x.id === id && x.sessionId === sessionId)
      if (i < 0) return { deleted: false }
      records.splice(i, 1)
      notify()
      return { deleted: true }
    },
  }
  const client = {
    account: async () => ({ authenticated: true, ownUsername: 'bot' }),
    group: async (_a, id) => ({ roomId: id }),
    message: async (_a, id) => db.message(id),
    groupMember: async (_a, id, username) => ({
      groupId: id,
      username,
      member: { username, mentionName: '小林' },
    }),
    sendByKey: async (_a, key) => {
      if (receipts.has(key)) return receipts.get(key)
      throw Object.assign(Error('miss'), { status: 404 })
    },
    sendText: async (accountId, destination, text, key, options) => {
      const r = { id: 'wx-' + key, accountId, destination, state: 'accepted' }
      assert(!receipts.has(key))
      sent.push({ destination, text, options })
      receipts.set(key, r)
      return r
    },
  }
  const native = new NativeTransport({
    store: db,
    client,
    signal: new AbortController().signal,
    config: {
      accountId: 'a',
      selfId: 'bot',
      sending: true,
      groups: [{ id: room }, { id: '2@chatroom' }],
      contacts: [],
    },
  })
  await native.verify()
  let seq = 0,
    clocks = 0
  const ctx = {
    get: (k) =>
      k === 'schedule'
        ? host
        : k === 'workspaceRegistry'
          ? { list: () => [], create: async () => ({ id: 'work' }) }
          : null,
    sessionController: { create: async () => ({ sessionId: 'clock-' + ++clocks }) },
    on(name, fn) {
      changes.add(fn)
      return () => changes.delete(fn)
    },
  }
  const args = {
    root,
    native,
    tenant: { tenant: { ok: true } },
    enqueue: (_room, fn) => Promise.resolve().then(fn),
  }
  let api = createReminders(ctx, args)
  t.after(async () => {
    await api.close()
    db.close()
    await rm(root, { recursive: true, force: true })
  })
  function scope(action, owner = 'person', group = room) {
    const m = {
      id: 'm' + ++seq,
      accountId: 'a',
      threadId: group,
      senderId: owner,
      direction: 'incoming',
      createdAt: new Date().toISOString(),
      type: 1,
      body: '提醒我',
    }
    db.commitEvent(String(seq), m)
    return {
      scene: 'group',
      messages: [m],
      groupId: group,
      accountId: 'a',
      sessionId: 'chat-' + seq,
      reminderRequest: action,
    }
  }
  return {
    db,
    host,
    native,
    records,
    sent,
    notify,
    scope,
    manage: (s, a) => api.manage(s, a),
    async restart() {
      await api.close()
      api = createReminders(ctx, args)
    },
    fire(r) {
      Object.assign(r, {
        status: 'inactive',
        lastDelivery: { scheduledAt: r.scheduledAt, messageId: 'timer-receipt' },
      })
      notify()
    },
  }
}
const later = () => new Date(Date.now() + 600000).toISOString()
async function until(fn) {
  for (let i = 0; i < 100; i++) {
    if (fn()) return
    await delay(5)
  }
  assert.fail('delivery did not settle')
}

test('only the requesting group member can list, edit or cancel; a repeated creation uses one DSH task', async (t) => {
  const f = await fixture(t),
    s = f.scope('create')
  const r = await f.manage(s, { action: 'create', at: later(), text: '喝水' })
  assert.match(r.reply, /已设好 #1/)
  assert.equal(f.records[0].sessionId, 'clock-1')
  await f.manage({ ...s, reminderAck: '' }, { action: 'create', at: later(), text: '重复' })
  assert.equal(f.records.length, 1)
  for (const scope of [f.scope('list', 'stranger'), f.scope('list', 'person', '2@chatroom')])
    assert.match((await f.manage(scope, { action: 'list' })).reply, /没有待提醒/)
  assert.match(
    (await f.manage(f.scope('cancel', 'stranger'), { action: 'cancel', id: 1 })).reply,
    /没有待提醒/,
  )
  assert.match(
    (await f.manage(f.scope('update'), { action: 'update', id: 1, after_seconds: 90, text: '站起来' }))
      .reply,
    /已更新.*站起来/,
  )
  assert.equal(f.records[0].title, '站起来')
  assert.match((await f.manage(f.scope('cancel'), { action: 'cancel', id: 1 })).reply, /已取消/)
  f.notify()
  assert.equal(f.records.length, 0)
  assert.equal(f.sent.length, 0)
})
test('durable receipt, restart, native acceptance and repeated callbacks yield one real mention payload', async (t) => {
  const f = await fixture(t)
  await f.manage(f.scope('create'), { action: 'create', after_seconds: 30, text: '起床啦' })
  f.notify()
  await delay(15)
  assert.equal(f.sent.length, 0)
  f.native.sending = false
  f.fire(f.records[0])
  await delay(15)
  assert.equal(f.sent.length, 0)
  f.native.sending = true
  await f.restart()
  await until(() => f.sent.length === 1)
  assert.deepEqual(f.sent[0], {
    destination: room,
    text: '@小林\u2005起床啦',
    options: { mentions: { userIds: ['person'], positions: [{ start: 0, end: 4, index: 0 }] } },
  })
  // Reopen the exact interval between Native's accepted receipt and Fish's final state write.
  f.db.db.prepare("UPDATE fish_reminders SET state='sending',receipt=NULL WHERE id=1").run()
  await f.restart()
  f.notify()
  f.notify()
  await until(() => f.db.db.prepare('SELECT state FROM fish_reminders').get().state === 'sent')
  assert.equal(f.sent.length, 1)
})
test('DSH rejection cannot produce a promise; a committed but lost create response is recovered by its source marker', async (t) => {
  const f = await fixture(t),
    s = f.scope('create'),
    create = f.host.create
  f.host.create = async (...args) => {
    await create(...args)
    throw Error('disconnected after persistence')
  }
  await assert.rejects(f.manage(s, { action: 'create', after_seconds: 100, text: '喝水' }))
  assert.doesNotMatch(
    reminderDecision({ ...s, decision: { action: 'reply', text: '一定准时叫你' } }).text,
    /一定|已设好/,
  )
  await f.restart()
  assert.match(
    (await f.manage(s, { action: 'create', after_seconds: 100, text: '喝水' })).reply,
    /已设好 #1/,
  )
  assert.equal(f.records.length, 1)
})
test('a quiet or offline reminder may be cancelled after the DSH clock fires', async (t) => {
  const f = await fixture(t)
  await f.manage(f.scope('create'), { action: 'create', at: later(), text: '开会' })
  f.native.sending = false
  f.fire(f.records[0])
  assert.match((await f.manage(f.scope('cancel'), { action: 'cancel', id: 1 })).reply, /已取消/)
  f.native.sending = true
  await f.restart()
  await delay(15)
  assert.equal(f.sent.length, 0)
})
test('reminder intent uses outer message text only and raw session-wide DSH tools stay inaccessible', () => {
  const msg = { threadId: room, type: 1, body: '@大肥鱼 2点叫我起床' }
  assert.equal(reminderIntent(msg, 'bot'), 'create')
  assert.equal(reminderIntent({ ...msg, body: '把我的提醒改到三点' }, 'bot'), 'update')
  assert.equal(reminderIntent({ ...msg, body: '看看我的提醒' }, 'bot'), 'list')
  assert.equal(reminderIntent({ ...msg, body: '取消提醒 #1' }, 'bot'), 'cancel')
  assert.equal(reminderIntent({ ...msg, mentions: { userIds: ['other'] } }, 'bot'), '')
  assert.equal(reminderIntent({ ...msg, body: '你好', quote: { embeddedText: msg.body } }, 'bot'), '')
  assert(
    !effectiveTools([
      'schedule_create',
      'schedule_delete',
      'schedule_list',
      'schedule_update',
      REMINDER_TOOL,
    ]).includes('schedule_delete'),
  )
})

test('retrying a cancellation whose host response was lost cannot cancel a newer reminder', async (t) => {
  const f = await fixture(t)
  await f.manage(f.scope('create'), { action: 'create', at: later(), text: '第一条' })
  const cancel = f.scope('cancel'),
    remove = f.host.delete
  f.host.delete = async (args) => {
    await remove(args)
    throw Error('reply lost')
  }
  await assert.rejects(f.manage(cancel, { action: 'cancel' }))
  await f.manage(f.scope('create'), { action: 'create', at: later(), text: '第二条' })
  f.host.delete = remove
  assert.match((await f.manage(cancel, { action: 'cancel' })).reply, /已取消提醒 #1/)
  assert.equal(f.records.length, 1)
  assert.equal(f.records[0].title, '第二条')
})
