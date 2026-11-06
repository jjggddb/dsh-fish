/** Fish's persistent image collection. Original bytes and provenance stay together. */
import { randomUUID, createHash } from 'node:crypto'
import { existsSync, readFileSync, renameSync, mkdirSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { writeAtomic } from './store.js'
import { withFileLock } from './tenant.js'
import { sanitizeForeign, screenOutgoing } from './guard.js'

export const MAX_IMAGE = 10 * 1024 * 1024
const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const invalid = (text) => Object.assign(Error(text), { code: 'INVALID_GALLERY' })
function directory(root) {
  const dest = join(root, 'gallery'),
    old = join(root, 'stickers')
  // Same filesystem rename preserves every file, ID, note and disabled flag, including on restart.
  if (existsSync(dest) && existsSync(join(old, 'index.json')))
    throw invalid('检测到两份图库索引，请先合并备份')
  if (!existsSync(dest) && existsSync(old)) {
    try {
      renameSync(old, dest)
    } catch (error) {
      if (!existsSync(dest)) throw error
    }
  }
  return dest
}
const file = (root, item) => join(directory(root), item.id + '.' + extensions[item.mime])
export function listGallery(root) {
  try {
    return JSON.parse(readFileSync(join(directory(root), 'index.json'), 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}
function validateItem(item) {
  if (!/^[0-9a-f-]{36}$/i.test(item.id) || !Object.hasOwn(extensions, item.mime))
    throw invalid('图库索引损坏')
}
export function migrateGallery(root) {
  for (const item of listGallery(root)) validateItem(item)
}
export function imageMime(bytes) {
  if (
    bytes.length >= 45 &&
    bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
    bytes.readUInt32BE(8) === 13 &&
    bytes.toString('ascii', 12, 16) === 'IHDR' &&
    bytes.readUInt32BE(16) &&
    bytes.readUInt32BE(20) &&
    bytes.subarray(-12).equals(Buffer.from('0000000049454e44ae426082', 'hex'))
  )
    return 'image/png'
  if (
    bytes.length > 12 &&
    bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) &&
    bytes.readUInt16BE(bytes.length - 2) === 0xffd9
  )
    return 'image/jpeg'
  if (bytes.length > 13 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6)) && bytes.at(-1) === 0x3b)
    return 'image/gif'
  if (
    bytes.length > 20 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP' &&
    bytes.readUInt32LE(4) + 8 === bytes.length
  )
    return 'image/webp'
  return null
}
export function visibleImage(item, scope) {
  if (!item.enabled) return false
  if (!item.source || item.source.kind === 'import') return true
  if (item.source.kind === 'xhs') return scope.scene !== 'xhs' || scope.accountId === item.source.accountId
  if (item.source.kind === 'wechat' && item.source.reuse === 'collection') {
    const account = scope.scene === 'xhs' ? scope.wechatAccountId : scope.accountId
    return !!account && account === item.source.accountId
  }
  return (
    item.source.kind === 'wechat' &&
    ['group', 'private'].includes(scope.scene) &&
    item.source.accountId === scope.accountId &&
    item.source.threadId === scope.groupId
  )
}
export async function galleryBytes(root, item) {
  validateItem(item)
  const data = await readFile(file(root, item))
  if (hash(data) !== item.sha256 || imageMime(data) !== item.mime) throw invalid('图库原文件校验失败')
  return data
}
function description(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (
    !text ||
    [...text].length > 120 ||
    /[\r\n]/.test(text) ||
    sanitizeForeign(text).dropped ||
    !screenOutgoing(text).ok
  )
    throw invalid('请用不超过 120 字的单行备注描述图片')
  return text
}
function domain(source) {
  if (source?.kind === 'wechat')
    return JSON.stringify(['wechat', source.accountId, source.threadId, source.reuse || 'conversation'])
  if (source?.kind === 'xhs') return JSON.stringify(['xhs', source.accountId])
  return 'import'
}
export async function changeGallery(root, input, { source, scope, live = () => true } = {}) {
  const dir = directory(root)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const idx = join(dir, 'index.json')
  const result = await withFileLock(idx + '.lock', async () => {
    if (!live()) throw invalid('活动已结束')
    const items = listGallery(root)
    if (input.action === 'upload') {
      const note = description(input.description)
      const data = input.bytes || Buffer.from(typeof input.data === 'string' ? input.data : '', 'base64')
      const mime = imageMime(data)
      if (!mime || data.length > MAX_IMAGE || (!input.bytes && data.toString('base64') !== input.data))
        throw invalid('图片格式无效或超过 10 MiB')
      const sha256 = hash(data),
        duplicate = items.find((i) => i.sha256 === sha256 && domain(i.source) === domain(source))
      if (duplicate) {
        if (!scope || !visibleImage(duplicate, scope)) throw invalid('这张图片已在图库中')
        return duplicate
      }
      const item = {
        id: randomUUID(),
        mime,
        sha256,
        description: note,
        enabled: true,
        createdAt: new Date().toISOString(),
        source: source || { kind: 'import' },
      }
      await writeAtomic(file(root, item), data, 0o600)
      try {
        if (!live()) throw invalid('活动已结束')
        await writeAtomic(idx, JSON.stringify([...items, item]))
      } catch (error) {
        await rm(file(root, item), { force: true })
        throw error
      }
      return item
    }
    const item = items.find((i) => i.id === input.id && (!scope || visibleImage(i, scope)))
    if (!item) throw invalid('图片已移除或不属于当前会话')
    validateItem(item)
    if (input.action === 'delete') {
      await writeAtomic(idx, JSON.stringify(items.filter((i) => i !== item)))
      await rm(file(root, item), { force: true })
    } else {
      if (input.action === 'rename') item.description = description(input.description)
      else if (!scope && input.action === 'toggle' && typeof input.enabled === 'boolean')
        item.enabled = input.enabled
      else throw invalid('未知图库操作')
      await writeAtomic(idx, JSON.stringify(items))
    }
    return item
  })
  if (result.locked === false) throw invalid('图库正在使用，请重试')
  return result
}
