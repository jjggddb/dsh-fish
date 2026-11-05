/** Compatibility for historical voice events; no platform integration. */
import {similarity} from './derive.js'
export const VOICE_FRESH_DAYS=7
const ECHO_WINDOW_MS=3*86400000,ECHO_MIN_SIM=0.7
export function normVoice(text) {
  return String(text ?? '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/@[^\s]+/g, ' ')
    .replace(/[，。！？、；：「」『』（）()[\]{}<>《》~!?,.;:"'`~^*_+=|\\/#%&$@\-]/g, '')
    .replace(/[\s\u3000]+/g, '')
    .slice(0, 120)
}


export function findEcho(voice, events = []) {
  const t0 = Date.parse(voice.at ?? '')
  if (!Number.isFinite(t0)) return null
  const mine = normVoice(voice.text)
  // 只在**这条评论之后**的事件里找。按事件流里的先后判，不按毫秒：
  // 同一天里"先读到、后开口"时两条的 ts 可能只差几秒，甚至测试里是同一毫秒。
  const idx = events.findIndex((e) => e.id && e.id === voice.id)
  const after = idx >= 0 ? events.slice(idx + 1) : events
  for (const e of after) {
    if (e.type !== 'utterance' && e.type !== 'revise') continue
    const t = Date.parse(e.ts ?? '')
    if (!Number.isFinite(t) || t - t0 > ECHO_WINDOW_MS) continue
    if (similarity(mine, normVoice(e.text)) >= ECHO_MIN_SIM) return e
  }
  return null
}
