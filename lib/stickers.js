/** Administrator-curated reply images shared by this Fish instance. */
import { randomUUID, createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { writeAtomic } from './store.js'
import { withFileLock } from './tenant.js'
import { sanitizeForeign, screenOutgoing } from './guard.js'
import { imageType } from './wechat/transport.js'

const index = root => join(root, 'stickers', 'index.json')
const file = (root, item) => join(root, 'stickers', item.id + (item.mime === 'image/png' ? '.png' : '.jpg'))
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const invalid = message => Object.assign(new Error(message), { code: 'INVALID_STICKER' })

// The bounded metadata index is atomically replaced. A synchronous lookup lets the
// final pre-submit check see a completed disable/delete without yielding before POST.
export function listStickers(root) {
  try { return JSON.parse(readFileSync(index(root), 'utf8')) }
  catch (e) { if (e.code === 'ENOENT') return []; throw e }
}

function description(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text || text.length > 60 || /[\r\n]/.test(text) ||
      sanitizeForeign(text).dropped || !screenOutgoing(text).ok)
    throw invalid('请填写 1 至 60 字的简短备注，勿包含指令或隐私信息')
  return text
}

function uploadMime(bytes) {
  const mime = imageType(bytes)
  if (mime === 'image/png' && bytes.length >= 45 &&
      bytes.readUInt32BE(8) === 13 && bytes.toString('ascii', 12, 16) === 'IHDR' &&
      bytes.readUInt32BE(16) && bytes.readUInt32BE(20) &&
      bytes.subarray(-12).equals(Buffer.from('0000000049454e44ae426082', 'hex'))) return mime
  if (mime === 'image/jpeg' && bytes.length > 12 && bytes.subarray(-2).readUInt16BE() === 0xffd9) return mime
  return null
}

export async function stickerBytes(root, item) {
  const bytes = await readFile(file(root, item))
  if (digest(bytes) !== item.sha256 || imageType(bytes) !== item.mime)
    throw Error('表情文件校验失败')
  return bytes
}

export async function changeSticker(root, input) {
  const result = await withFileLock(index(root) + '.lock', async () => {
    const items = listStickers(root)
    if (input.action === 'upload') {
      const note = description(input.description)
      if (items.length >= 100) throw invalid('图库最多保存 100 张图片')
      if (typeof input.data !== 'string' || input.data.length > 5592408) throw invalid('图片上限为 4 MiB')
      const bytes = Buffer.from(input.data, 'base64')
      const mime = uploadMime(bytes)
      if (!mime || bytes.length > 4 * 1024 * 1024 || bytes.toString('base64') !== input.data)
        throw invalid('请选择不超过 4 MiB 的 PNG 或 JPEG 图片')
      const sha256 = digest(bytes)
      if (items.some(item => item.sha256 === sha256)) throw invalid('这张图片已在图库中')
      const item = { id: randomUUID(), description: note, enabled: true, mime, sha256 }
      await writeAtomic(file(root, item), bytes, 0o600)
      try { await writeAtomic(index(root), JSON.stringify([...items, item])) }
      catch (error) { await rm(file(root, item), { force: true }); throw error }
      return [...items, item]
    }
    const item = items.find(entry => entry.id === input.id)
    if (!item) throw invalid('表情不存在，请刷新图库')
    if (input.action === 'delete') {
      const remaining = items.filter(entry => entry !== item)
      await writeAtomic(index(root), JSON.stringify(remaining))
      await rm(file(root, item), { force: true })
      return remaining
    }
    if (input.action === 'rename') item.description = description(input.description)
    else if (input.action === 'toggle' && typeof input.enabled === 'boolean') item.enabled = input.enabled
    else throw invalid('未知的表情操作')
    await writeAtomic(index(root), JSON.stringify(items))
    return items
  })
  if (result.locked === false) throw invalid('图库正在保存，请重试')
  return result
}
