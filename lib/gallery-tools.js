import { activeTurn } from './scope.js'
import { guardWrite } from './tenant.js'
import { changeGallery, galleryBytes, listGallery, visibleImage, MAX_IMAGE } from './gallery.js'
import { imageAttachment } from './media.js'
import { blocked } from './xhs/policy.js'

export const GALLERY_TOOL = 'fish_gallery'
export function accessible(item, scope, policy) {
  if (!visibleImage(item, scope)) return false
  if (item.source?.kind !== 'xhs') return true
  if (!policy) return false
  return (
    item.source.accountId === policy.accountId &&
    policy.allowedTypes.includes(item.source.type) &&
    !blocked(
      policy,
      item.description,
      item.source.title,
      item.source.text,
      item.source.author,
      item.source.authorId,
    )
  )
}
export function seenImage(scope, data, source) {
  scope.seenImages ??= []
  if (
    data.length > MAX_IMAGE ||
    scope.seenImages.reduce((n, x) => n + x.data.length, 0) + data.length > 32 * 1024 * 1024
  )
    return undefined
  return scope.seenImages.push({ data, source })
}
function numberFor(scope, id) {
  scope.galleryIds ??= []
  const i = scope.galleryIds.indexOf(id)
  return i < 0 ? scope.galleryIds.push(id) : i + 1
}
export function itemByNumber(root, scope, n, policy) {
  const id = Number.isInteger(n) && n > 0 && scope.galleryIds?.[n - 1]
  const item = id && listGallery(root).find((i) => i.id === id && accessible(i, scope, policy))
  if (!item) throw Error('这张图片不在本轮可用的图库结果中，请重新查找')
  return item
}
export function registerGallery(ctx, { root, tenant, policy = () => null }) {
  return ctx.tools.register({
    name: GALLERY_TOOL,
    description:
      '自己的图库。search 按印象/备注找图，无关键词则翻看图库；view 重看原图；save 将本轮真正看过的 seenImageNo 或已授权 read_image 返回的 fileImageNo 收藏并写备注；微信图片默认留原会话，愿意跨平台再用时明确选择 reuse=collection。rename、delete 修改或删除自己的图片。galleryNo 可交给 fish_decide 回图，或用来分享、配图发布。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['search', 'view', 'save', 'rename', 'delete'] },
        query: { type: 'string', maxLength: 120 },
        offset: { type: 'integer', minimum: 0 },
        galleryNo: { type: 'integer', minimum: 1 },
        seenImageNo: { type: 'integer', minimum: 1 },
        fileImageNo: { type: 'integer', minimum: 1 },
        reuse: { type: 'string', enum: ['conversation', 'collection'] },
        note: { type: 'string', maxLength: 120 },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_a, { attachment, ...result }) => [
        { type: 'text', text: JSON.stringify(result) },
        ...(attachment ? [{ type: 'image', attachment }] : []),
      ],
    },
    async execute(args, exec) {
      const caller = guardWrite(tenant, exec, GALLERY_TOOL),
        sessionId = caller.sessionId,
        s = caller.ok && activeTurn(root, sessionId)
      const live = () =>
        !!s &&
        activeTurn(root, sessionId) === s &&
        !s.decisionOnly &&
        tenant.tenant?.ok !== false &&
        !exec.signal?.aborted
      if (
        !live() ||
        !['group', 'private', 'xhs'].includes(s.scene) ||
        !s.accountId ||
        (!s.messages?.length && !s.xhs)
      )
        throw Error('没有可用的图库会话')
      const currentPolicy = policy()
      if (args.action === 'search') {
        const words = String(args.query || '')
          .trim()
          .normalize('NFKC')
          .toLowerCase()
          .split(/\s+/)
          .filter(Boolean)
        const rows = listGallery(root)
          .filter(
            (i) =>
              accessible(i, s, currentPolicy) &&
              words.every((w) => i.description.normalize('NFKC').toLowerCase().includes(w)),
          )
          .reverse()
        const offset = Math.max(0, args.offset || 0)
        return {
          total: rows.length,
          images: rows.slice(offset, offset + 20).map((i) => ({
            galleryNo: numberFor(s, i.id),
            note: i.description,
            origin: i.source?.kind || 'import',
          })),
        }
      }
      if (args.action === 'save') {
        let image =
          Number.isInteger(args.seenImageNo) && args.seenImageNo > 0 && s.seenImages?.[args.seenImageNo - 1]
        if (args.fileImageNo !== undefined) {
          const ref =
            Number.isInteger(args.fileImageNo) && args.fileImageNo > 0 && s.fileImages?.[args.fileImageNo - 1]
          if (args.seenImageNo !== undefined || !ref || !s.groupId)
            throw Error('请选择本轮读取的一张本地图片')
          const attachment = await ctx.get('attachments').readImage(ref, exec.signal)
          image = {
            data: Buffer.from(attachment.data),
            source: {
              kind: 'wechat',
              via: 'file',
              accountId: s.accountId,
              threadId: s.groupId,
              turnId: s.turnId,
            },
          }
        }
        if (
          !image ||
          !accessible({ enabled: true, source: image.source, description: args.note }, s, currentPolicy)
        )
          throw Error('只可收藏本轮实际看过的图片')
        const source =
          image.source.kind === 'wechat'
            ? { ...image.source, reuse: args.reuse === 'collection' ? 'collection' : 'conversation' }
            : image.source
        const item = await changeGallery(
          root,
          { action: 'upload', description: args.note, bytes: image.data },
          { source, scope: s, live },
        )
        return { galleryNo: numberFor(s, item.id), note: item.description }
      }
      const item = itemByNumber(root, s, args.galleryNo, currentPolicy)
      if (args.action === 'view') {
        const attachment = await imageAttachment(
          ctx,
          exec,
          await galleryBytes(root, item),
          item.mime,
          'gallery-image',
        )
        if (!live() || !listGallery(root).some((i) => i.id === item.id && accessible(i, s, policy())))
          throw Error('图片已不可用')
        return { galleryNo: args.galleryNo, note: item.description, attachment }
      }
      if (!['delete', 'rename'].includes(args.action)) throw Error('未知图库操作')
      await changeGallery(
        root,
        { action: args.action, id: item.id, description: args.note },
        { scope: s, live },
      )
      return { ok: true }
    },
  })
}
