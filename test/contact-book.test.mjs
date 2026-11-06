import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contactBook, selectMentions, remarkChanges, asksToMention } from '../lib/family.js'
const room = '1@chatroom'
const people = [
  { id: 'a', title: '二哥' },
  { id: 'b', title: '二哥' },
  { id: 'c', title: '三哥' },
]
const msg = (body, extra = {}) => ({
  id: 'src',
  senderId: 'other',
  type: 1,
  threadId: room,
  body,
  ...extra,
})
const members = new Map(
  [
    ['a', '甲'],
    ['b', '乙'],
  ].map(([id, n]) => [id, { username: id, mentionName: n, displayName: n }]),
)
test('duplicate notes ask for clarification; private or unverified contacts cannot be pinged', () => {
  const messages = [msg('艾特一下你二哥')],
    book = contactBook(messages, people, [], members, room, 'fish')
  assert.equal(
    book.cards.some((p) => p.id === 'c'),
    false,
  )
  assert.throws(() => selectMentions(book, [1], messages), /多位/)
  assert.deepEqual(
    selectMentions(book, [1], [msg('艾特叫甲的二哥')]).map((p) => p.id),
    ['a'],
  )
  const elsewhere = contactBook(
    [msg('你三哥是谁')],
    people,
    [{ id: 'c', remark: '外群的别名' }],
    members,
    room,
    'fish',
  )
  assert.match(elsewhere.context, /三哥/)
  assert.doesNotMatch(elsewhere.context, /外群的别名/)
  assert.throws(() => selectMentions(elsewhere, [1], [msg('你三哥是谁')]), /明确请求/)
  assert.equal(asksToMention(msg('别艾特你二哥'), 'fish'), false)
  assert.equal(asksToMention(msg('艾特一下你二哥', { mentions: { userIds: ['another'] } }), 'fish'), false)
  assert.throws(() => remarkChanges(book, [{ contactNo: 3, remark: '二哥' }], messages), /其他人/)
})
