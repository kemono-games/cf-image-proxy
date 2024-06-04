import { decodeImage, transformImage } from '../utils'
import { BaseAdapter } from './base'

export class OthersAdapter extends BaseAdapter {
  public referer = ''

  static check(url: string, env?: CloudflareBindings) {
    const urlObj = new URL(url)
    const host = urlObj.host
    const allowedHosts = env?.ALLOW_OTHER_HOSTS.split(',')
    if (!allowedHosts) return false
    return allowedHosts.includes(host)
  }

  get targetFormat() {
    const { accept } = this.options
    if (!accept) return 'jpg'
    if (/image\/webp/.test(accept)) {
      return 'webp'
    }
    return 'jpg'
  }

  async postProcess(response: Response) {
    let imageData = await decodeImage(await response.arrayBuffer())
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
