/** Group IDs and personal WeChat IDs occupy distinct namespaces. */
export function targets(groups = [], contacts = [], selfId = '') {
  function list(rows, group) {
    if (!Array.isArray(rows) || rows.length > 100) throw Error('每类名单最多 100 条')
    const seen = new Set()
    return rows.map((row) => {
      const id = String(row?.id || '').trim()
      const valid = group
        ? /^\d+@chatroom$/.test(id)
        : /^[A-Za-z0-9_.-]{1,128}$/.test(id) && id !== selfId
      if (!valid || seen.has(id))
        throw Error('请输入有效且不重复的' + (group ? '群 ID' : '联系人微信 ID'))
      seen.add(id)
      return {
        id,
        name: String(row.name || '')
          .trim()
          .slice(0, 128),
      }
    })
  }
  return { groups: list(groups, true), contacts: list(contacts, false) }
}
