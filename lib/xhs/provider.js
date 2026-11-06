// Read-only HTTP surface of xpzouying/xiaohongshu-mcp. Signed feed handles stay on the host.
import { sanitizeForeign } from '../guard.js'

import { preview, checkDetail, blocked, noteKind } from './policy.js'
import { serviceOrigin, validId } from './config.js'
const clean = (value, length) => sanitizeForeign(typeof value === 'string' ? value : '').text.slice(0, length)

// Some real comment @s arrive as comment/item, even on a third party's note.
// Keep these as candidates until the detail repeats the exact comment, author and address.
function ownerNotice(n, owner, nickname) {
  if (n?.from?.user_id !== owner || !validId(n.id) || !validId(n.feed_id) || !validId(n.comment_id) ||
      typeof n.feed_xsec_token !== 'string' || !n.feed_xsec_token) return null
  const type = /^(?:(?:mention|at)[/_-]comment|comment[/_-](?:mention|at))$/i
  const title = /^(?:在(?:一条)?评论(?:中|里|区))?(?:@|提到|提及)了?你[。！!]?$/u
  const explicit = type.test(n.type) || title.test(String(n.title || '').replace(/\s/g, ''))
  const address = typeof nickname === 'string' && nickname.trim() ? '@' + nickname.trim() : ''
  if (!explicit && !(n.type === 'comment/item' && address && n.comment_text?.trimStart().startsWith(address))) return null
  return { id: n.id, feedId: n.feed_id, token: n.feed_xsec_token, commentId: n.comment_id,
    senderId: n.from.user_id, text: clean(n.comment_text, 2000), ...(!explicit ? { address } : {}) }
}

export function xhsClient(raw, signal, request = fetch) {
  const base = serviceOrigin(raw.baseUrl)
  async function api(path, body) {
    const token = base === serviceOrigin(raw.credentialOrigin ?? raw.baseUrl) ? process.env.FISH_XHS_TOKEN : undefined
    const response = await request(new URL('/api/v1/' + path, base), {
      method: body ? 'POST' : 'GET', redirect: 'error',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
    })
    if (!response.ok) throw Object.assign(Error('XHS HTTP ' + response.status), { status: response.status })
    const result = await response.json()
    if (result.success !== true || !result.data) throw Error('XHS read failed')
    return result.data
  }
  async function verify() {
    const status = await api('login/status')
    if (status.is_logged_in !== true || status.user_id !== raw.accountId) throw Error('XHS login identity mismatch')
    return status
  }
  async function checked(path, body) {
    await verify()
    const data = await api(path, body)
    const account = await verify()
    return { payload: data, account }
  }
  return {
    async comment({ feedId, token, commentId, text }, canSubmit) {
      await verify()
      await canSubmit()
      const data = commentId
        ? await api('feeds/comment/reply', { feed_id: feedId, xsec_token: token, comment_id: commentId, content: text })
        : await api('feeds/comment', { feed_id: feedId, xsec_token: token, content: text })
      if (data.feed_id !== feedId || data.success !== true || (commentId && data.target_comment_id !== commentId))
        throw Error('评论结果需核对')
    },
    async publish({ title, text, images }, canSubmit) {
      await verify()
      await canSubmit()
      const data = await api('publish', { title, content: text, images })
      if (data.status !== '发布完成' || data.title !== title || data.images !== images.length)
        throw Error('发布结果需核对')
    },
    async mentions() {
      const { payload, account } = await checked('notifications/list', { tab: 'mentions', limit: 100 })
      const data = payload.data
      if (data?.tab !== 'mentions' || !Array.isArray(data.items)) throw Error('Invalid XHS notifications')
      return data.items.map(n => ownerNotice(n, raw.ownerId, account.username)).filter(Boolean)
    },
    async list(keyword) {
      if (keyword && blocked(raw, keyword)) throw Error('搜索词被内容设置过滤')
      const { payload: data } = keyword ? await checked('feeds/search', { keyword }) : await checked('feeds/list')
      if (!Array.isArray(data.feeds)) throw Error('Invalid XHS feed list')
      return data.feeds.flatMap(f => {
        if (!validId(f?.id) || !f.xsecToken || typeof f.xsecToken !== 'string' || !f.noteCard) return []
        const title = preview(raw, f.noteCard)
        return title === null ? [] : [{ id: f.id, token: f.xsecToken, title: clean(title, 180) }]
      }).slice(0, 16)
    },
    async read(feedId, token, mention) {
      const { payload: data } = await checked('feeds/detail', { feed_id: feedId, xsec_token: token })
      const note = data.data?.note
      if (note?.noteId !== feedId || data.feed_id !== feedId) throw Error('XHS note identity mismatch')
      checkDetail(raw, note, mention?.text)
      let locatedComment
      if (mention) {
        const rows = data.data?.comments?.list || []
        const match = rows.flatMap(row => [row, ...(row.subComments || [])]).find(row => row.id === mention.commentId)
        if (match && (match.userInfo?.userId !== mention.senderId || (match.noteId && match.noteId !== feedId)))
          throw Error('XHS comment identity mismatch')
        if (mention.address && !match?.content?.trimStart().startsWith(mention.address))
          throw Error('XHS direct address not confirmed in original comment')
        checkDetail(raw, note, match?.content)
        // A paginated detail can omit the exact comment. The platform notification still binds all three IDs.
        locatedComment = { text: match ? clean(match.content, 2000) : mention.text,
          locatedBy: match ? 'detail' : 'notification' }
      }
      const result = { feedId, title: clean(note.title, 240), text: clean(note.desc, 8000), type: clean(note.type, 24) }
      const kind = noteKind(note)
      if (kind) result.contentType = kind
      if (validId(note.user?.userId)) result.authorId = note.user.userId
      if (locatedComment) result.locatedComment = locatedComment
      return result
    },
  }
}
