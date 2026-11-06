import { dateKey } from '../settings.js'
import { noteKinds } from './config.js'

const fold = text => String(text ?? '').normalize('NFKC').toLowerCase()
export function blocked(config, ...texts) {
  return (config.blockedWords || []).some(word => texts.some(text => fold(text).includes(fold(word))))
}

export function noteKind(note) {
  if (note.type === 'video') return 'video'
  if (['text', 'pure_text'].includes(note.type)) return 'text'
  if (['image', 'image_text'].includes(note.type)) return 'image'
  if (note.type === 'normal' && (Array.isArray(note.imageList) || note.imageList === null))
    return note.imageList?.length ? 'image' : 'text'
  return null
}

// The upstream preview for normal notes often has a cover but no image count.
// An ambiguous candidate may expose its ID; only detail can release its text.
export function preview(config, card) {
  if (blocked(config, card.displayTitle, card.user?.nickname, card.user?.userId)) return null
  const types = config.allowedTypes ?? noteKinds
  const kind = noteKind(card)
  if (kind) return types.includes(kind) ? card.displayTitle || '' : null
  if (card.type === 'normal' && types.includes('image') && types.includes('text')) return card.displayTitle || ''
  return (card.type !== 'normal' ? types.length > 0 : types.includes('image') || types.includes('text')) ? '待读取核实类型' : null
}

export function checkDetail(config, note, comment) {
  const types = config.allowedTypes ?? noteKinds
  const kind = noteKind(note)
  const permitted = kind ? types.includes(kind) : note.type === 'normal' && types.includes('image') && types.includes('text')
  if (!permitted ||
      blocked(config, note.title, note.desc, note.user?.nickname, note.user?.userId, comment))
    throw Object.assign(Error('笔记被当前内容设置过滤'), { code: 'XHS_FILTERED' })
}

// Reserve a bounded slice before browsing. A crash retains the reservation; normal completion refunds unused time.
export function reserveTime(db, minutes, timezone, now = Date.now()) {
  const day = dateKey(new Date(now), timezone)
  const used = db.prepare('SELECT ms FROM browsing_time WHERE day=?').get(day)?.ms || 0
  const available = minutes === null ? 240000 : Math.min(240000, minutes * 60000 - used)
  if (available <= 0) return null
  let duration = available
  if (dateKey(new Date(now + duration), timezone) !== day) {
    let lo = 0, hi = duration
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2)
      if (dateKey(new Date(now + mid), timezone) === day) lo = mid
      else hi = mid
    }
    duration = hi
  }
  db.prepare('INSERT INTO browsing_time(day,ms) VALUES(?,?) ON CONFLICT(day) DO UPDATE SET ms=ms+excluded.ms').run(day, duration)
  return { day, start: now, duration, finish(end = Date.now()) {
    const refund = Math.max(0, duration - Math.max(0, end - now))
    db.prepare('UPDATE browsing_time SET ms=ms-? WHERE day=?').run(refund, day)
  } }
}
