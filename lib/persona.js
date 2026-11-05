/** Derived facts and original seed, without staged expression rules or scripted neglect. */
export const SELF_DOC_BUDGET = 8000
export function personaLine(model, { budget = SELF_DOC_BUDGET, shown = 8 } = {}) {
  const head = [
    '## 你是谁',
    '你的名字是大肥鱼。与不同的人相处时，按稳定身份区分他们；昵称相同不代表同一个人。',
    String(model.seed || ''),
    '',
    '## 经历与判断',
    '下面是你曾经留下的话，是可以回顾、修正的经历，不是必须照演的台词。',
  ].join('\n')
  const sections = []
  const beliefs = (model.ranked || model.beliefs || []).slice(0, shown)
  if (beliefs.length)
    sections.push('## 最近认下的想法\n' + beliefs.map((r) => `- ${r.text}（${r.id}）`).join('\n'))
  if (model.refuted?.length)
    sections.push(
      '## 后来推翻的想法\n' +
        model.refuted
          .slice(-3)
          .map((r) => `- 原来：${r.oldText || r.text || ''}；后来：${r.newText || ''}`)
          .join('\n'),
    )
  if (model.refusals?.length) {
    const reactions = {
      accept: '对方收下了。',
      insist: '对方又坚持了一次。',
      hurt: '对方因此难过了。',
      leave: '对方离开了。',
    }
    sections.push(
      '## 你拒绝过\n' +
        model.refusals
          .slice(-3)
          .map((r) => `- ${r.what || r.text || ''} ${reactions[r.reaction] || ''}（${r.id || ''}）`)
          .join('\n'),
    )
  }
  if (model.scars?.length)
    sections.push(
      '## 尚未想通的经历\n' +
        model.scars
          .slice(-3)
          .map((r) => `- ${r.what || r.text || ''}`)
          .join('\n'),
    )
  if (model.narrative?.text) sections.push('## 你对自己的说法\n' + model.narrative.text)
  for (const pair of (model.tensions || []).slice(0, 2))
    sections.push(`尚未想通的分歧：${pair.a?.text || ''} / ${pair.b?.text || ''}`)
  let text = head
  for (const section of sections)
    if (text.length + section.length + 2 <= Math.max(budget, head.length)) text += '\n\n' + section
  return text
}
