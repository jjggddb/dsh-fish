/** DSH owns the clock. Only a durable DSH delivery receipt can wake a Fish reminder. */
import { randomUUID } from 'node:crypto'
import { ensureWorkspace } from './home.js'
import { reserveReply } from './group-state.js'
import { sanitizeForeign, screenOutgoing } from './guard.js'
import { loadConfig, quietAt } from './settings.js'

export const REMINDER_TOOL = 'wechat_reminder'
export const rawScheduleTool = (name) =>
  ['schedule_create', 'schedule_list', 'schedule_update', 'schedule_delete'].includes(name)

// A reminder command gets its own input window. Tool arguments never identify the speaker or chat.
export function reminderIntent(message, selfId, inReminderExchange = false, pendingAction) {
  if (
    !message.threadId?.endsWith('@chatroom') ||
    message.type !== 1 ||
    (message.quote?.senderId && message.quote.senderId !== selfId) ||
    (message.mentions?.userIds || []).some((id) => id !== selfId)
  )
    return ''
  const text = String(message.body || '').trim()
  if (!text || sanitizeForeign(text).dropped) return ''
  const topic = /提醒|闹钟|定时任务|[#＃]\s*\d+/.test(text)
  if (
    ((topic || inReminderExchange) && /取消|删除|撤销|关掉|不用.{0,5}提醒|别.{0,4}提醒/.test(text)) ||
    /(?:不用|不要|别)(?:再)?(?:叫我|喊我|提醒我)/.test(text)
  )
    return 'cancel'
  if (
    (topic || inReminderExchange) &&
    /改(?:到|成|为|一下|下|时间|提醒)|修改|调整|推迟|提前|延后/.test(text)
  )
    return 'update'
  if (topic && /有哪些|有什么|查看|列出|看看|还有.{0,6}提醒|提醒列表|查询/.test(text)) return 'list'
  if (
    /提醒我|叫我起床|叫醒我|喊醒我|喊我|通知我|(?:到时|到点|点|分钟后).{0,6}(?:叫我|@我)|(?:设|加|建|订|定).{0,8}(?:闹钟|提醒)|(?:帮我|给我|记得).{0,12}叫我/.test(
      text,
    )
  )
    return 'create'
  if (
    inReminderExchange &&
    pendingAction &&
    /[#＃]?\d|今天|明天|后天|上午|下午|晚上|中午|凌晨|[一二两三四五六七八九十]+点|分钟|小时/.test(text)
  )
    return pendingAction
  return ''
}

const failureReply = {
  create: '提醒还没设好。请告诉我具体时间和要提醒的事。',
  update: '提醒还没改好。请告诉我是哪一条，以及要改成什么。',
  cancel: '还没有确认取消哪一条提醒。可以先问我有哪些提醒。',
  list: '这次没有查到你的提醒列表，请稍后再问我。',
}
export function reminderDecision(scope) {
  if (!scope.reminderRequest) return scope.decision
  return {
    action: 'reply',
    text: scope.reminderAck || scope.reminderProblem || failureReply[scope.reminderRequest],
    mentions: [],
    awaiting: [],
    reminder: true,
    pendingReminder:
      scope.reminderNeedsChoice || (!scope.reminderAck && !scope.reminderProblem)
        ? scope.reminderRequest
        : undefined,
  }
}

const marker = (key) => '微信提醒计时回执 ' + key + '。Fish 负责微信投递，请结束本轮，无需调用工具。'
const format = (at, zone) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(at))

function targetTime(args, message) {
  if (args.at != null && args.after_seconds != null) throw Error('请选择明确时刻或相对时长中的一种')
  if (args.at == null && args.after_seconds == null) return undefined
  let time
  if (args.at != null) {
    if (
      typeof args.at !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(args.at)
    )
      throw Error('时间需包含日期和时区')
    time = Date.parse(args.at)
  } else {
    if (!Number.isSafeInteger(args.after_seconds) || args.after_seconds <= 0)
      throw Error('时长须为正整数秒')
    time = Date.parse(message.createdAt) + args.after_seconds * 1000
  }
  if (!Number.isFinite(time) || time <= Date.now() || time > 253402300799999)
    throw Error('请指定以后的有效时间')
  return new Date(time).toISOString()
}
function note(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (
    !text ||
    [...text].length > 100 ||
    /[\r\n\p{Cc}]/u.test(text) ||
    sanitizeForeign(text).dropped ||
    !screenOutgoing(text).ok
  )
    throw Error('请用一句简短的话说明提醒内容')
  return text
}

export function createReminders(ctx, { root, native, tenant, enqueue, log = () => {} }) {
  const db = native.store.db
  db.exec(`CREATE TABLE IF NOT EXISTS fish_reminder_clocks(room TEXT PRIMARY KEY, session TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS fish_reminder_commands(
      source TEXT PRIMARY KEY, account TEXT NOT NULL, room TEXT NOT NULL, owner TEXT NOT NULL,
      action TEXT NOT NULL, target INTEGER NOT NULL, reply TEXT);
    CREATE TABLE IF NOT EXISTS fish_reminders(
    id INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL, room TEXT NOT NULL, owner TEXT NOT NULL,
    source TEXT NOT NULL, session TEXT NOT NULL, token TEXT NOT NULL UNIQUE, task TEXT UNIQUE,
    created INTEGER NOT NULL DEFAULT (unixepoch()),
    state TEXT NOT NULL DEFAULT 'creating', body TEXT, occurrence TEXT, receipt TEXT,
    UNIQUE(account,room,source))`)
  function isClock(id) {
    return !!id && !!db.prepare('SELECT 1 FROM fish_reminder_clocks WHERE session=?').get(id)
  }
  async function clockSession(room) {
    const saved = db.prepare('SELECT session FROM fish_reminder_clocks WHERE room=?').get(room)
    if (saved) return saved.session
    const home = await ensureWorkspace(ctx, { root })
    if (!home.ok) throw Error('提醒工作区未就绪')
    const created = await ctx.sessionController.create({ workspaceId: home.wsId })
    const id = created?.sessionId ?? created?.id
    if (!id) throw Error('DSH 提醒会话未创建')
    db.prepare('INSERT INTO fish_reminder_clocks(room,session) VALUES(?,?)').run(room, id)
    await ctx.sessionController.rename?.({ sessionId: id, title: '大肥鱼 · 群提醒计时' }).catch(() => {})
    return id
  }
  const pending = () =>
    db.prepare("SELECT * FROM fish_reminders WHERE state IN ('creating','active','sending')").all()
  const byId = (id) => db.prepare('SELECT * FROM fish_reminders WHERE id=?').get(id)
  const state = (id, value) => db.prepare('UPDATE fish_reminders SET state=? WHERE id=?').run(value, id)
  const scheduled = (records, row) =>
    records.find(
      (r) =>
        r.sessionId === row.session &&
        r.kind === 'at' &&
        r.prompt === marker(row.token) &&
        (!row.task || r.id === row.task),
    )
  function attach(row, record) {
    if (row.state === 'creating')
      db.prepare("UPDATE fish_reminders SET task=?, state='active' WHERE id=?").run(record.id, row.id)
  }
  let closed = false,
    tail = Promise.resolve()
  const queued = new Set()
  function serial(fn) {
    const job = tail.then(() => {
      if (closed) throw Error('提醒服务已关闭')
      return fn()
    })
    tail = job.catch(() => {})
    return job
  }
  function service() {
    const host = ctx.get?.('schedule')
    if (!host?.create || !host.catalog) throw Error('DSH 定时服务未启用')
    return host
  }
  async function manage(scope, args, signal) {
    return serial(async () => {
      if (
        scope.scene !== 'group' ||
        scope.messages?.length !== 1 ||
        scope.decisionOnly ||
        !scope.reminderRequest ||
        scope.decision ||
        scope.accountId !== native.identity().accountId ||
        !tenant.tenant?.ok ||
        !native.permits(scope.groupId)
      )
        throw Error('仅处理原群中本人明确请求的提醒')
      const m = scope.messages[0]
      if (
        m.threadId !== scope.groupId ||
        m.accountId !== scope.accountId ||
        !m.senderId ||
        m.senderId === native.identity().selfId
      )
        throw Error('提醒来源不匹配')
      const { config } = await loadConfig(root)
      if (!config.tools.allow.includes(REMINDER_TOOL)) throw Error('微信提醒未获授权')
      const host = service(),
        action = args.action
      if (action !== scope.reminderRequest && action !== 'list') throw Error('操作必须与这条微信请求一致')
      if (scope.reminderAck && action !== 'list') return { reply: scope.reminderAck }
      const prior = db.prepare('SELECT * FROM fish_reminder_commands WHERE source=?').get(m.id)
      if (
        prior &&
        (prior.account !== m.accountId || prior.room !== m.threadId || prior.owner !== m.senderId)
      )
        throw Error('提醒请求身份不符')
      if (prior && prior.action === action && prior.reply) {
        scope.reminderAck = prior.reply
        return { reply: prior.reply }
      }
      const records = await host.catalog()
      const mine = pending().filter(
        (r) => r.account === m.accountId && r.room === m.threadId && r.owner === m.senderId,
      )
      const active = mine
        .map((row) => ({ row, record: scheduled(records, row) }))
        .filter((x) => x.record && (x.record.status === 'active' || x.record.lastDelivery))
      const line = ({ row, record }) =>
        '#' + row.id + ' ' + format(record.scheduledAt, config.group.timezone) + ' ' + note(record.title)
      let reply
      if (action === 'list') {
        reply = active.length ? '你的提醒：' + active.map(line).join('；') : '你在本群没有待提醒的事项。'
        if (scope.reminderRequest !== 'list')
          return {
            reminders: active.map((x) => ({
              id: x.row.id,
              at: x.record.scheduledAt,
              text: note(x.record.title),
            })),
          }
      } else if (action === 'create') {
        let row = db
          .prepare('SELECT * FROM fish_reminders WHERE account=? AND room=? AND source=?')
          .get(m.accountId, m.threadId, m.id)
        let record = row && scheduled(records, row)
        if (!record) {
          if (row && row.state !== 'creating') throw Error('这条消息的提醒已经处理过')
          const at = targetTime(args, m),
            title = note(args.text)
          if (!at) throw Error('请先确认具体提醒时间')
          if (!row) {
            const result = db
              .prepare(
                'INSERT INTO fish_reminders(account,room,owner,source,session,token) VALUES(?,?,?,?,?,?)',
              )
              .run(m.accountId, m.threadId, m.senderId, m.id, await clockSession(m.threadId), randomUUID())
            row = byId(result.lastInsertRowid)
          }
          record = await host.create(row.session, { at, title, prompt: marker(row.token) }, signal)
        }
        if (
          !record?.id ||
          record.kind !== 'at' ||
          !Number.isFinite(Date.parse(record.scheduledAt)) ||
          record.prompt !== marker(row.token) ||
          record.status === 'inactive'
        )
          throw Error('未确认 DSH 任务创建成功')
        attach(row, record)
        reply =
          '已设好 #' +
          row.id +
          '，' +
          format(record.scheduledAt, config.group.timezone) +
          ' 我会在本群 @ 你：' +
          note(record.title)
      } else {
        const explicitNumber = m.body?.match(/[#＃]\s*(\d+)/u)
        const target = prior?.target ?? (explicitNumber ? Number(explicitNumber[1]) : args.id)
        const selected =
          target == null
            ? active.length === 1
              ? active[0]
              : null
            : active.find((x) => x.row.id === target)
        if (!selected) {
          if (prior?.action === 'cancel' && !records.some((r) => r.id === byId(prior.target)?.task)) {
            state(prior.target, 'cancelled')
            reply = '已取消提醒 #' + prior.target + '。'
          } else {
            scope.reminderNeedsChoice = active.length > 0
            reply = !active.length
              ? '你在本群没有待提醒的事项。'
              : '请选择你在本群的提醒编号：' + active.map(line).join('；')
          }
        } else {
          const { row, record } = selected
          if (row.state === 'sending') throw Error('已经开始投递，请等待微信回执')
          db.prepare(
            'INSERT OR IGNORE INTO fish_reminder_commands(source,account,room,owner,action,target) VALUES(?,?,?,?,?,?)',
          ).run(m.id, m.accountId, m.threadId, m.senderId, action, row.id)
          if (action === 'cancel') {
            const res = await host.delete({ sessionId: row.session, id: record.id }, signal)
            if (!res.deleted) throw Error('未确认 DSH 任务取消成功')
            state(row.id, 'cancelled')
            reply = '已取消提醒 #' + row.id + '。'
          } else {
            if (record.status !== 'active') {
              scope.reminderAck = '这条提醒已经到期，等待投递。可以取消后另设新时间。'
              return { reply: scope.reminderAck }
            }
            const at = targetTime(args, m),
              title = args.text == null ? undefined : note(args.text)
            if (!at && !title) throw Error('请说明新的时间或内容')
            const { sessionId, status, lastDelivery, ...expected } = record
            const res = await host.update(
              {
                sessionId,
                id: record.id,
                expected,
                ...(at && { change: { kind: 'at', at } }),
                ...(title && { title }),
              },
              signal,
            )
            if (!res.record || res.record.id !== record.id) throw Error('任务已到期或发生变化，请重新查询')
            reply = '提醒已更新：' + line({ row, record: res.record })
          }
        }
      }
      if (action === 'update' || action === 'cancel')
        db.prepare('UPDATE fish_reminder_commands SET reply=? WHERE source=? AND action=?').run(
          reply,
          m.id,
          action,
        )
      scope.reminderAck = reply
      return { reply }
    })
  }

  async function deliver(id) {
    const row = byId(id)
    if (!row || !['active', 'sending'].includes(row.state)) return
    const r = scheduled(await service().catalog(), row)
    if (!r || r.status !== 'inactive' || r.lastDelivery?.scheduledAt !== r.scheduledAt) return
    const { config } = await loadConfig(root)
    if (
      !tenant.tenant?.ok ||
      !native.verified ||
      !native.sending ||
      !native.permits(row.room) ||
      row.account !== native.identity().accountId ||
      !config.tools.allow.includes(REMINDER_TOOL) ||
      (config.group.doNotDisturb && quietAt(new Date(), config.group))
    )
      return
    const source = native.store.message(row.source)
    if (source?.senderId !== row.owner || source.threadId !== row.room || source.accountId !== row.account)
      return
    const live = await native.source(row.source)
    if (
      live.accountId !== row.account ||
      live.threadId !== row.room ||
      live.senderId !== row.owner ||
      live.direction !== 'incoming'
    )
      return
    if (!(await reserveReply(root, row.room, config))) return
    if (!row.body) {
      const member = await native.member(row.room, row.owner)
      if (!member?.mentionName) throw Error('提醒对象已不在原群')
      if (/[\p{Cc}\u2005]/u.test(member.mentionName) || Buffer.byteLength(member.mentionName) > 1024)
        throw Error('微信成员的提及名称无效')
      const text = '@' + member.mentionName + '\u2005' + note(r.title)
      if (!screenOutgoing(text).ok || sanitizeForeign(text).dropped) throw Error('提醒内容无法发送')
      // Persist the exact wire text before submission; recovery uses identical payload and native key.
      db.prepare("UPDATE fish_reminders SET state='sending', body=?, occurrence=? WHERE id=?").run(
        text,
        r.scheduledAt,
        id,
      )
      row.body = text
    }
    const receipt = await native.sendText(row.source, row.body, {
      mentions: [row.owner],
      part: 'reminder:' + row.token,
      mentionPositions: [{ start: 0, end: row.body.indexOf('\u2005') + 1, index: 0 }],
      beforeSubmit: () =>
        !closed &&
        tenant.tenant?.ok &&
        native.sending &&
        native.permits(row.room) &&
        !(config.group.doNotDisturb && quietAt(new Date(), config.group)),
    })
    if (receipt?.state !== 'accepted') throw Error('微信尚未确认接收提醒')
    db.prepare("UPDATE fish_reminders SET state='sent', receipt=? WHERE id=?").run(receipt.id, id)
  }
  async function scan() {
    const rows = pending()
    if (!rows.length) return
    const records = await service().catalog()
    for (const row of rows) {
      const r = scheduled(records, row)
      if (!r) {
        if (row.state !== 'creating') state(row.id, 'cancelled')
        else if (Date.now() - row.created * 1000 > 600000) state(row.id, 'failed')
        continue
      }
      attach(row, r)
      if (!r.lastDelivery || r.status !== 'inactive' || queued.has(row.id)) continue
      queued.add(row.id)
      // Never wait for the room queue while holding the schedule mutation lock.
      enqueue(row.room, () => serial(() => deliver(row.id)))
        .catch(() => log('reminder_delivery_pending'))
        .finally(() => queued.delete(row.id))
    }
  }
  let scanning = false,
    again = false
  function wake() {
    if (closed) return
    if (scanning) {
      again = true
      return
    }
    scanning = true
    serial(scan)
      .catch(() => log('reminder_reconcile_pending'))
      .finally(() => {
        scanning = false
        if (again) {
          again = false
          wake()
        }
      })
  }
  const off = ctx.on('schedule/changed', wake)
  // Retry undelivered receipts after Native reconnects or a Host notification is missed.
  const timer = setInterval(wake, 15000)
  timer.unref?.()
  wake()
  return {
    manage,
    wake,
    isClock,
    async close() {
      closed = true
      clearInterval(timer)
      off?.()
      await tail
    },
  }
}
