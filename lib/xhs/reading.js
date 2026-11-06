import { sanitizeForeign } from '../guard.js'
import { frame, imageAttachment, sendableImage } from '../media.js'
import { imageMime } from '../gallery.js'
import { seenImage } from '../gallery-tools.js'
import { blocked } from './policy.js'

export function xhsUrl(value) {
  try {
    const u = new URL(value)
    return (
      ['http:', 'https:'].includes(u.protocol) &&
      !u.username &&
      !u.password &&
      !u.port &&
      /(^|\.)(?:xhslink\.com|xiaohongshu\.com)$/.test(u.hostname)
    )
  } catch {
    return false
  }
}
export function messageLinks(message) {
  const links = [
    message?.link?.url,
    message?.quote?.embeddedLink?.url,
    ...(message?.body?.match(/https?:\/\/[^\s<>"'，。！？）】]+/giu) || []),
  ]
  return [...new Set(links.filter(xhsUrl))]
}
export async function readMedia(ctx, exec, turn, state, args, config, live) {
  const note = state.opened.get(args.feedId)?.note
  if (!note) throw Error('请先打开这篇笔记')
  const kind = args.action
  if (kind !== 'image' && note.contentType !== 'video') throw Error('只可读取已获准的视频笔记画面或字幕')
  if (kind === 'subtitle') {
    const body = await state.client.media(note.feedId, kind)
    const text = sanitizeForeign(body.toString('utf8')).text.slice(0, 12000)
    if (!live() || blocked(config, text)) throw Error('字幕不可用')
    return { subtitle: text }
  }
  let data = await state.client.media(note.feedId, kind, args.imageNo || 1)
  const second = args.second ?? 0
  if (kind === 'video' || !imageMime(data))
    data = await frame(data, kind === 'video' ? second : 0, state.signal)
  const display = await sendableImage(data, state.signal)
  const attachment = await imageAttachment(ctx, exec, display, imageMime(display), 'xhs-' + kind)
  if (!live()) throw Error('活动已结束')
  const source = {
    kind: 'xhs',
    accountId: config.accountId,
    feedId: note.feedId,
    type: note.contentType,
    title: note.title,
    text: note.text,
    author: note.authorName || '',
    authorId: note.authorId || '',
  }
  const n = seenImage(turn, data, source)
  return {
    ...(n ? { seenImageNo: n } : {}),
    attachment,
    ...(kind === 'video' ? { frameSecond: second } : { imageNo: args.imageNo || 1 }),
  }
}
