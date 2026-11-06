import { createHash } from 'node:crypto'
import { dateKey, loadConfig, quietAt } from '../settings.js'
import { reserveReply } from '../group-state.js'
import { sanitizeForeign, screenOutgoing } from '../guard.js'
import { blocked } from './policy.js'

const string = { type: 'string' }
export const actions = {
  xhs_comment: { flag: 'commentEnabled', description: '暂存评论。用本轮实际打开的 feedId；回复主人评论时填本轮准确定位的 commentId。', properties: { feedId: string, commentId: string, text: string }, required: ['feedId', 'text'] },
  xhs_publish: { flag: 'publishEnabled', description: '暂存图文笔记。imageNumbers 指定设置里允许配图的序号（从 1 开始）。', properties: { title: string, text: string, imageNumbers: { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 18 } }, required: ['title', 'text', 'imageNumbers'] },
  xhs_share: { flag: 'shareEnabled', description: '暂存笔记链接分享给管理员选定的微信群，仅发送本轮已读原帖的公开链接。', properties: { feedId: string }, required: ['feedId'] },
}

function outbound(config, input, limit) {
  const text = typeof input === 'string' ? input.trim() : ''
  if (!text || [...text].length > limit || !screenOutgoing(text).ok || sanitizeForeign(text).dropped || blocked(config, text))
    throw Error('外发内容为空、过长或被过滤')
  return text
}

export function stageAction(name, args, state, config) {
  if (!config[actions[name].flag] || state.plans.has(name)) throw Error('该操作未开启或已在本轮暂存')
  let plan
  if (name === 'xhs_publish') {
    const numbers = args.imageNumbers
    if (!Array.isArray(numbers) || !numbers.length || numbers.length > 18 ||
        new Set(numbers).size !== numbers.length || numbers.some(n => !Number.isInteger(n) || !config.publishImages[n - 1]))
      throw Error('请选择管理员授权的配图序号')
    plan = { title: outbound(config, args.title, 20), text: outbound(config, args.text, 1000),
      images: numbers.map(n => config.publishImages[n - 1]) }
  } else {
    const read = state.opened.get(args.feedId)
    if (!read) throw Error('需要本轮成功读过的原帖')
    if (name === 'xhs_comment') {
      if (args.commentId && args.commentId !== read.commentId) throw Error('目标评论不属于本轮已定位的原帖')
      plan = { feedId: args.feedId, token: read.token, commentId: args.commentId || '', text: outbound(config, args.text, 300) }
    } else {
      plan = { feedId: args.feedId, target: config.shareTarget }
    }
  }
  state.plans.set(name, plan)
  return { staged: true }
}

export async function deliverActions({ state, turnId, db, client, root, config, native, allowed, live, log }) {
  for (const [name, plan] of state.plans) {
    const key = createHash('sha256').update(JSON.stringify([config.accountId, turnId, name])).digest('hex')
    if (db.prepare('SELECT 1 FROM external_actions WHERE id=?').get(key)) continue
    const target = plan.target?.groupId || plan.commentId || plan.feedId || plan.title
    let reserved = false
    let zone = 'Asia/Shanghai'
    const canSubmit = async () => {
      const { config: settings } = await loadConfig(root)
      if (!live() || !allowed.includes(name) || !settings.tools.allow.includes(name) || !config[actions[name].flag] ||
          (settings.group.doNotDisturb && quietAt(new Date(), settings.group))) throw Error('外发已停止或处于免打扰时段')
      zone = settings.group.timezone
      const day = dateKey(new Date(), zone)
      if (db.prepare("SELECT count(*) AS n FROM external_actions WHERE day=? AND name=? AND status!='blocked'").get(day, name).n >= config.dailyActionLimit)
        throw Error('已达到当日操作限额')
      db.prepare("INSERT INTO external_actions(id,day,name,target,status) VALUES(?,?,?,?,'unknown')").run(key, day, name, target)
      reserved = true
    }
    try {
      if (name === 'xhs_comment') await client.comment(plan, canSubmit)
      if (name === 'xhs_publish') await client.publish(plan, canSubmit)
      if (name === 'xhs_share') {
        const transport = native?.()
        if (!transport?.canShareXhs(plan.target)) throw Error('分享目标群当前不可发送')
        const { config: settings } = await loadConfig(root)
        if (!await reserveReply(root, plan.target.groupId, settings)) throw Error('目标群发送额度已用完')
        await canSubmit()
        await transport.shareXhs(plan.target, plan.feedId, key, () =>
          live() && !(settings.group.doNotDisturb && quietAt(new Date(), settings.group)))
      }
      if (reserved) db.prepare("UPDATE external_actions SET status='accepted' WHERE id=?").run(key)
    } catch (error) {
      // A write without a matching receipt is never replayed. The durable row survives a restart.
      if (!reserved) db.prepare("INSERT OR IGNORE INTO external_actions(id,day,name,target,status) VALUES(?,?,?,?,'blocked')")
        .run(key, dateKey(new Date(), zone), name, target)
      if (reserved && (error.code === 'SEND_BLOCKED' || [401, 403].includes(error.status)))
        db.prepare("UPDATE external_actions SET status='blocked' WHERE id=?").run(key)
      log?.(name + ': external action was not confirmed')
    }
  }
}
