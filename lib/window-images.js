/** References belong to this exact observation, never to an agent-selected chat or message. */
export function windowImages(messages) {
  const images = []
  for (const m of messages) {
    if (m.type === 3 || m.type === 47 || Array.isArray(m.media) && m.media.some(asset => asset?.kind === 'image' && asset.source !== 'quote'))
      images.push({ messageId: m.id, quoted: false })
    if (m.quote?.embeddedImage || m.quote?.type === 3)
      images.push({ messageId: m.id, quoted: true })
  }
  return images
}
export function imageLabels(images, messageId) {
  const labels = {}
  images.forEach((ref, index) => {
    if (ref.messageId === messageId) labels[ref.quoted ? 'quotedImageNo' : 'imageNo'] = index + 1
  })
  return labels
}
export function selectImage(scope, number) {
  if (!Number.isInteger(number) || number < 1 || number > (scope.images?.length || 0))
    throw Error('请使用本轮消息上标出的图片编号')
  return scope.images[number - 1]
}
