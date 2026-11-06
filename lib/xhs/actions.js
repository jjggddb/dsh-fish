import { createHash } from 'node:crypto'
import { dateKey, loadConfig, quietAt } from '../settings.js'
import { reserveReply } from '../group-state.js'
import { sanitizeForeign, screenOutgoing } from '../guard.js'
import { blocked } from './policy.js'

import { itemByNumber } from '../gallery-tools.js'
import { galleryBytes, imageMime } from '../gallery.js'
import { sendableImage } from '../media.js'

const string = { type: 'string' },
  number = { type: 'integer', minimum: 1 }
export const actions = {
  xhs_comment: {
    description: '暂存原帖评论或回复已定位的评论。',
    properties: { feedId: string, commentId: string, text: string },
    required: ['feedId', 'text'],
  },
  xhs_publish: {
    description: '从 fish_gallery 找图，用 galleryNos 暂存自己的图文笔记。',
    properties: {
      title: string,
      text: string,
      galleryNos: { type: 'array', items: number, minItems: 1, maxItems: 18 },
    },
    required: ['title', 'text', 'galleryNos'],
  },
  xhs_share: {
    description: 'targets 查看可达的微信会话，send 选择 targetNo，分享看过的 feedId 或选中的 galleryNo。',
    properties: {
      action: { type: 'string', enum: ['targets', 'send'] },
      targetNo: number,
      feedId: string,
      galleryNo: number,
    },
    required: ['action'],
  },
}
function resolveImage(state, number, config) {
  const item = itemByNumber(state.root, state.turn, number, config)
  if (item.source?.kind === 'wechat' && item.source.reuse !== 'collection')
    throw Error('这张微信图片仅供原会话使用')
  return item
}

function outbound(config, input, limit) {
  const text = typeof input === 'string' ? input.trim() : ''
  if (
    !text ||
    [...text].length > limit ||
    !screenOutgoing(text).ok ||
    sanitizeForeign(text).dropped ||
    blocked(config, text)
  )
    throw Error('外发内容为空、过长或被过滤')
  return text
}

export function stageAction(name, args, state, config) {
  if (name === 'xhs_share' && args.action === 'targets')
    return { targets: state.targets.map((t, i) => ({ targetNo: i + 1, name: t.name, scene: t.scene })) }
  let plan
  if (name === 'xhs_publish') {
    const numbers = args.galleryNos
    if (
      !Array.isArray(numbers) ||
      !numbers.length ||
      numbers.length > 18 ||
      new Set(numbers).size !== numbers.length
    )
      throw Error('请选择图库返回的配图序号')
    plan = {
      title: outbound(config, args.title, 20),
      text: outbound(config, args.text, 1000),
      gallery: numbers.map((no) => ({ no, id: resolveImage(state, no, config).id })),
    }
  } else if (name === 'xhs_share') {
    const target = Number.isInteger(args.targetNo) && state.targets[args.targetNo - 1]
    if (args.action !== 'send' || !target || Boolean(args.feedId) === Boolean(args.galleryNo))
      throw Error('请选择一项分享内容和已授权会话')
    if (args.feedId && !state.opened.has(args.feedId)) throw Error('需要本轮成功读过的原帖')
    plan = {
      target,
      feedId: args.feedId,
      gallery: args.galleryNo
        ? [{ no: args.galleryNo, id: resolveImage(state, args.galleryNo, config).id }]
        : [],
    }
  } else {
    const read = state.opened.get(args.feedId)
    if (!read) throw Error('需要本轮成功读过的原帖')
    if (args.commentId && args.commentId !== read.commentId) throw Error('目标评论不属于本轮已定位的原帖')
    plan = {
      feedId: args.feedId,
      token: read.token,
      commentId: args.commentId || '',
      text: outbound(config, args.text, 300),
    }
  }
  // One logical dispatch per note/comment, recipient and image. Re-planning a publish
  // after a lost receipt must not create a second public post in the same activity.
  const selection = JSON.stringify([name,plan.target?.groupId,plan.feedId,plan.commentId,plan.target && plan.gallery?.[0]?.id])
  if(state.plans.has(selection))throw Error('这项操作已在本轮暂存')
  state.plans.set(selection,{name,plan})
  return { staged: true }
}

export async function deliverActions({
  state,
  turnId,
  db,
  client,
  root,
  config,
  native,
  allowed,
  live,
  log,
}) {
  for (const [selection, {name,plan}] of state.plans) {
    const legacyKey = createHash('sha256').update(JSON.stringify([config.accountId,turnId,name])).digest('hex')
    const key = createHash('sha256')
      .update(JSON.stringify([config.accountId, turnId, selection]))
      .digest('hex')
    if (db.prepare('SELECT 1 FROM external_actions WHERE id IN (?,?)').get(key,legacyKey)) continue
    const target = plan.target?.groupId || plan.commentId || plan.feedId || plan.title
    let reserved = false
    let zone = 'Asia/Shanghai'
    const verifyImages = () =>
      (plan.gallery || []).map(({ no, id }) => {
        const item = resolveImage(state, no, config)
        if (item.id !== id) throw Error('图片已发生变化')
        return item
      })
    const canSubmit = async () => {
      const { config: settings } = await loadConfig(root)
      if (
        !live() ||
        !allowed.includes(name) ||
        !settings.tools.allow.includes(name) ||
        (settings.group.doNotDisturb && quietAt(new Date(), settings.group))
      )
        throw Error('外发已停止或处于免打扰时段')
      zone = settings.group.timezone
      const day = dateKey(new Date(), zone)
      verifyImages()
      db.prepare("INSERT INTO external_actions(id,day,name,target,status) VALUES(?,?,?,?,'unknown')").run(
        key,
        day,
        name,
        target,
      )
      reserved = true
    }
    try {
      if (name === 'xhs_comment') await client.comment(plan, canSubmit)
      const images = []
      let bytesTotal = 0
      for (const item of verifyImages()) {
        const bytes = await sendableImage(await galleryBytes(root, item), state.signal)
        bytesTotal += bytes.length
        if (bytesTotal > 22 * 1024 * 1024) throw Error('配图合计过大')
        images.push({ data: bytes.toString('base64'), mime: imageMime(bytes) })
      }
      if (name === 'xhs_publish') await client.publish({ ...plan, images }, canSubmit)
      if (name === 'xhs_share') {
        const transport = native?.()
        if (!transport?.canShareXhs(plan.target)) throw Error('分享目标群当前不可发送')
        const { config: settings } = await loadConfig(root)
        if (!(await reserveReply(root, plan.target.groupId, settings))) throw Error('目标群发送额度已用完')
        await canSubmit()
        await transport.shareXhs(
          plan.target,
          plan.feedId || Buffer.from(images[0].data, 'base64'),
          key,
          () =>
            live() && verifyImages() && !(settings.group.doNotDisturb && quietAt(new Date(), settings.group)),
        )
      }
      if (reserved) db.prepare("UPDATE external_actions SET status='accepted' WHERE id=?").run(key)
    } catch (error) {
      // A write without a matching receipt is never replayed. The durable row survives a restart.
      if (!reserved)
        db.prepare(
          "INSERT OR IGNORE INTO external_actions(id,day,name,target,status) VALUES(?,?,?,?,'blocked')",
        ).run(key, dateKey(new Date(), zone), name, target)
      if (reserved && (error.code === 'SEND_BLOCKED' || [401, 403].includes(error.status)))
        db.prepare("UPDATE external_actions SET status='blocked' WHERE id=?").run(key)
      log?.(name + ': external action was not confirmed')
    }
  }
}
