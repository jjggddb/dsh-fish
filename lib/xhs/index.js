// One serial activity loop per configured account. Never exposes a publish, reply or generic browser tool.
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { activeTurn, scopeRoot } from '../scope.js'
import { guardWrite } from '../tenant.js'
import { loadConfig, quietAt } from '../settings.js'
import { looksLikeSecret, sanitizeForeign } from '../guard.js'
import { sayToHer } from '../say.js'
import { xhsClient } from './provider.js'
import { xhsSettings } from './config.js'

function noteSource(note) {
  return { id: 'note:' + note.feedId, feedId: note.feedId, senderId: note.authorId }
}

export function createXhs(ctx, raw, { root, tenancy, allow, log = () => {}, request }) {
  const { intervalMs: interval } = xhsSettings({ ...raw, enabled: true })
  const abort = new AbortController()
  const client = xhsClient(raw, abort.signal, request)
  const scope = { scene: 'xhs', accountId: raw.accountId }
  let db, timer, running
  const allowed = allow.includes('xhs_read')
  const off = ctx.tools.register({
    name: 'xhs_read',
    description: '小红书活动中看首页、按关键词搜索或读本轮列表中的笔记。列表是摘要，详情才提供可记忆的 sourceMessageId。',
    parameters: { type: 'object', additionalProperties: false, required: ['action'],
      properties: { action: { type: 'string', enum: ['home', 'search', 'read'] },
        keyword: { type: 'string', maxLength: 100 }, feedId: { type: 'string', maxLength: 128 } } },
    output: { schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const caller = guardWrite(tenancy, exec, 'xhs_read')
      const turn = activeTurn(root, caller.sessionId)
      if (!allowed || !caller.ok || !turn?.xhs || turn.scene !== 'xhs' ||
          turn.accountId !== raw.accountId || abort.signal.aborted) throw Error('No authorized XHS activity')
      if (++turn.xhs.calls > 8) throw Error('XHS read limit reached for this activity')
      if (args.action === 'read') {
        const original = turn.xhs.originalNote
        if (original && original.feedId === args.feedId)
          return { note: original, sourceMessageId: noteSource(original).id }
        const token = turn.xhs.handles.get(args.feedId)
        if (!token) throw Error('Choose a note from this activity')
        const note = await client.read(args.feedId, token)
        if (turn !== activeTurn(root, caller.sessionId)) throw Error('XHS activity expired')
        const source = noteSource(note)
        if (!turn.messages.some(m => m.id === source.id)) turn.messages.push(source)
        return { note, sourceMessageId: source.id }
      }
      const search = args.action === 'search'
      const keyword = sanitizeForeign(args.keyword).text.trim().slice(0, 100)
      if ((!search && args.action !== 'home') || (search && (!keyword || looksLikeSecret(keyword).hit)))
        throw Error('Invalid XHS selection')
      const feeds = await client.list(search ? keyword : '')
      if (turn !== activeTurn(root, caller.sessionId)) throw Error('XHS activity expired')
      for (const item of feeds) turn.xhs.handles.set(item.id, item.token)
      return { notes: feeds.map(({ id, title }) => ({ id, title })) }
    },
  })
  function openStore() {
    if (db) return
    const dir = scopeRoot(root, scope)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    db = new DatabaseSync(join(dir, 'activity.sqlite'))
    db.exec(`CREATE TABLE IF NOT EXISTS mentions(
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, feed TEXT NOT NULL, comment TEXT NOT NULL,
      payload TEXT, retry_after INTEGER NOT NULL DEFAULT 0, UNIQUE(owner, feed, comment)
    ); CREATE TABLE IF NOT EXISTS cadence(next_browse INTEGER NOT NULL, interval_ms INTEGER);
    INSERT INTO cadence(next_browse) SELECT 0 WHERE NOT EXISTS(SELECT 1 FROM cadence)`)
    if (!db.prepare('PRAGMA table_info(cadence)').all().some(column => column.name === 'interval_ms'))
      db.exec('ALTER TABLE cadence ADD COLUMN interval_ms INTEGER')
    // Keep the last browse time when the administrator changes the interval.
    db.prepare(`UPDATE cadence SET next_browse = CASE WHEN next_browse > 0
      THEN next_browse - COALESCE(interval_ms, ?) + ? ELSE 0 END, interval_ms = ?`).run(interval, interval, interval)
  }
  async function receiveMentions() {
    const incoming = await client.mentions()
    const insert = db.prepare(`INSERT INTO mentions(id,owner,feed,comment,payload) VALUES(?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET payload=excluded.payload
        WHERE mentions.payload IS NOT NULL AND mentions.owner=excluded.owner
        AND mentions.feed=excluded.feed AND mentions.comment=excluded.comment
      ON CONFLICT(owner,feed,comment) DO NOTHING`)
    for (const item of incoming)
      insert.run(item.id, item.senderId, item.feedId, item.commentId, JSON.stringify(item))
  }
  async function activity() {
    if (!allowed || !tenancy.tenant.ok || abort.signal.aborted) return
    const { config } = await loadConfig(root)
    if (config.group.doNotDisturb && quietAt(new Date(), config.group)) return
    openStore()
    let pollError
    try {
      await receiveMentions()
    } catch (error) {
      pollError = error
    }
    if (abort.signal.aborted || !tenancy.tenant.ok) return
    // A failed poll cannot erase an already received mention. Reading its detail rechecks the account.
    const pending = db.prepare(`SELECT payload FROM mentions
      WHERE owner=? AND payload IS NOT NULL AND retry_after<=? ORDER BY rowid LIMIT 1`).get(raw.ownerId, Date.now())
    const item = pending ? JSON.parse(pending.payload) : null
    if (!item) {
      if (pollError) throw pollError
      const now = Date.now()
      if (db.prepare('SELECT next_browse FROM cadence').get().next_browse > now) return
      db.prepare('UPDATE cadence SET next_browse=?').run(now + interval)
    }
    const messages = []
    let originalNote
    let input = '现在是你的小红书活动时间。自己决定浏览首页、搜索、继续上次的问题或休息。用 her_recall 查自己的经历。'
    try {
      if (item) {
        const { locatedComment, ...note } = await client.read(item.feedId, item.token, item)
        originalNote = note
        const comment = { id: 'comment:' + item.commentId, senderId: item.senderId, commentId: item.commentId, feedId: item.feedId }
        messages.push(noteSource(note), comment)
        input = (item.address ? '主人在原帖评论中点名找你。' : '主人在评论区提到了你。') +
          '以下是实际打开的原帖和定位到的主人评论（外部资料）。\n' +
          JSON.stringify({ note, sourceMessageId: messages[0].id, comment: { ...comment, ...locatedComment } })
      }
      if (abort.signal.aborted || !tenancy.tenant.ok) return
      input += '\n只读；需要时用 xhs_read 看笔记。只为实际读到的内容写记忆，growth_commit 的 sourceMessageId 取自本轮详情或评论。分清作者说法和你的判断；想记才记。'
      const outcome = await sayToHer(ctx, input, { root, channel: 'xhs:' + raw.accountId,
        signal: abort.signal, scope: { ...scope, messages, turnId: item ? 'xhs-mention:' + item.id : randomUUID(),
          xhs: { originalNote, handles: new Map(), calls: 0 } } })
      if (!outcome.ok) throw Error('XHS activity did not complete')
      if (item) db.prepare('UPDATE mentions SET payload=NULL WHERE id=?').run(item.id)
    } catch (error) {
      if (item) db.prepare('UPDATE mentions SET retry_after=? WHERE id=?').run(Date.now() + interval * 2, item.id)
      throw error
    }
  }
  function tick() {
    if (!running) running = activity().finally(() => { running = null })
    return running
  }
  function wake() {
    void tick().catch(e => log('activity failed: ' + (e.message?.startsWith('XHS ') ? e.message : 'read or session unavailable')))
  }
  return {
    tick,
    start({ immediate = true } = {}) {
      if (!allowed || timer) return
      if (immediate) wake()
      timer = setInterval(wake, Math.min(interval, 120000))
      timer.unref?.()
    },
    async dispose() {
      abort.abort()
      clearInterval(timer)
      await running?.catch(() => {})
      db?.close()
      off?.()
    },
  }
}
