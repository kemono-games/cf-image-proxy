import { decodeImage, transformImage } from '../utils'
import { BaseAdapter } from './base'

export class PixivAdapter extends BaseAdapter {
  static check(url: string) {
    const urlObj = new URL(url)
    const host = urlObj.host
    return host.includes('.pximg.net')
  }

  public fakeReferer = 'https://www.pixiv.net/'

  get targetFormat() {
    const { accept } = this.options
    if (!accept) return 'jpg'
    if (/image\/webp/.test(accept)) {
      return 'webp'
    }
    return 'jpg'
  }

  urlRegulation(url: string) {
    if (url.includes('novel-cover-original') && !url.includes('_master1200')) {
      return (
        url
          .replace('/novel-cover-original/', '/c/480x960/novel-cover-master/')
          .split('.')
          .slice(0, -1)
          .join('.') + '_master1200.jpg'
      )
    }
    return url
  }

  async postProcess(response: Response) {
    const origImageFormat = this.url.split('.').pop()
    if (origImageFormat === 'gif') {
      return response
    }
    let imageData = await decodeImage(
      await response.arrayBuffer(),
      origImageFormat ?? 'jpg',
    )
    const { image, mime } = await transformImage(
      imageData,
      this.targetFormat,
      this.options,
    )
    response = new Response(image, response)
    response.headers.set('Content-Type', mime)
    return response
  }
}
