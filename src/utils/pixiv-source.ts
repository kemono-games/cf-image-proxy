// Fixed, non-cropping pximg CDN thumbnail, independent of proxy w/q/Accept.
export const PIXIV_MODERATION_PROFILE = 'pximg-600x1200-q90-v1'

// Only this fixed official placeholder is exempt, not the s.pximg.net host.
export function isPixivModerationExempt(value: string): boolean {
  return value === 'https://s.pximg.net/common/images/no_profile.png'
}

export function pixivModerationSource(value: string): string {
  const url = new URL(value)
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !(url.hostname === 'pximg.net' || url.hostname.endsWith('.pximg.net')) ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new Error('Invalid Pixiv source')
  }
  let path = url.pathname.replace(/^\/c\/[^/]+\//, '/')
  if (/^\/(img-original|img-master|img-square)\//.test(path)) {
    path = path
      .replace(/^\/(img-original|img-square)\//, '/img-master/')
      .replace(/(?:_(?:master|square)1200)?\.[a-zA-Z0-9]+$/, '_master1200.jpg')
  } else if (/^\/novel-cover-(original|master)\//.test(path)) {
    path = path
      .replace('/novel-cover-original/', '/novel-cover-master/')
      .replace(/(?:_master1200)?\.[a-zA-Z0-9]+$/, '_master1200.jpg')
  }
  url.protocol = 'https:'
  url.hostname = 'i.pximg.net'
  url.pathname = `/c/600x1200_90${path}`
  url.hash = ''
  return url.href
}

export async function fetchPixivThumbnail(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, {
    headers: { Referer: 'https://www.pixiv.net/', Accept: 'image/jpeg' },
    // Do not follow a redirect to an original image or a different host.
    // Workers only supports follow/manual; 3xx is rejected by the status check.
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok || !response.body)
    throw new Error('Pixiv thumbnail download failed')
  const mime = response.headers
    .get('Content-Type')
    ?.split(';')[0]
    .trim()
    .toLowerCase()
  if (mime !== 'image/jpeg' && mime !== 'image/png') {
    await response.body.cancel()
    throw new Error('Pixiv thumbnail must be JPEG or PNG')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 5 * 1024 * 1024) {
        await reader.cancel()
        throw new Error('Pixiv thumbnail too large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  if (mime === 'image/png') {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10]
    if (
      bytes.length < 33 ||
      !signature.every((byte, i) => bytes[i] === byte) ||
      new DataView(bytes.buffer).getUint32(8) !== 13 ||
      new DataView(bytes.buffer).getUint32(12) !== 0x49484452
    ) {
      throw new Error('Invalid Pixiv PNG thumbnail')
    }
    // Bound decoded memory before invoking WASM, even for a small compressed file.
    const header = new DataView(bytes.buffer)
    const width = header.getUint32(16)
    const height = header.getUint32(20)
    if (!width || !height || width * height > 600 * 1200) {
      throw new Error('Pixiv PNG thumbnail dimensions too large')
    }
    const { pngToJpeg } = await import('./png-to-jpeg')
    const jpeg = await pngToJpeg(bytes.buffer)
    if (jpeg.byteLength > 5 * 1024 * 1024)
      throw new Error('Pixiv thumbnail too large')
    return jpeg
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new Error('Invalid Pixiv JPEG thumbnail')
  }
  return bytes.buffer
}
