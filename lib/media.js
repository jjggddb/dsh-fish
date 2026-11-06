import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { imageMime } from './gallery.js'

/** Decode a local file only. Never let FFmpeg follow an embedded URL or playlist. */
export async function frame(bytes, second = 0, signal) {
  const dir = await mkdtemp(join(tmpdir(), 'fish-frame-'))
  try {
    const path = join(dir, 'source')
    await writeFile(path, bytes, { mode: 0o600 })
    return await new Promise((resolve, reject) => {
      const proc = spawn(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-nostdin',
          '-protocol_whitelist',
          'file,pipe',
          '-format_whitelist',
          'mov,matroska,webm,avi,flv,gif,png_pipe,jpeg_pipe,webp_pipe,image2',
          '-threads',
          '1',
          '-ss',
          String(second),
          '-i',
          path,
          '-frames:v',
          '1',
          '-vf',
          "scale='min(1280,iw)':'min(1280,ih)':force_original_aspect_ratio=decrease",
          '-c:v',
          'mjpeg',
          '-threads',
          '1',
          '-f',
          'image2pipe',
          'pipe:1',
        ],
        {
          signal: AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]),
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      )
      const parts = []
      let n = 0
      proc.stdout.on('data', (p) => {
        n += p.length
        if (n > 4 * 1024 * 1024) proc.kill()
        else parts.push(p)
      })
      proc.on('error', reject)
      proc.on('close', (code) => {
        const img = Buffer.concat(parts)
        if (code || n > 4 * 1024 * 1024 || imageMime(img) !== 'image/jpeg')
          reject(Error('该时间点没有可解码画面'))
        else resolve(img)
      })
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
export async function sendableImage(bytes, signal) {
  const type = imageMime(bytes)
  if (['image/jpeg', 'image/png'].includes(type) && bytes.length <= 4 * 1024 * 1024) return bytes
  return frame(bytes, 0, signal)
}
export async function imageAttachment(ctx, exec, data, mediaType, name) {
  const route = exec.agent?.session?.requestHeader?.()?.config
  const provider = route?.provider ?? exec.agent?.options?.provider,
    model = route?.model ?? exec.agent?.options?.model
  const info = provider && model && (await ctx.get?.('llm')?.resolveModelInfo(provider, model, exec.signal))
  if (!info?.inputModalities?.includes('image')) throw Error('当前模型无法看图')
  const service = ctx.get?.('attachments')
  if (!service?.saveImage) throw Error('图片附件服务未启用')
  if (!['image/jpeg', 'image/png'].includes(mediaType)) {
    data = await sendableImage(data, exec.signal)
    mediaType = imageMime(data)
  }
  return service.saveImage({ data, mediaType, name })
}
