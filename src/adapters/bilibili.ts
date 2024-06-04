import { BaseAdapter, ConvertOptions } from './base'

export class BilibiliCDNAdapter extends BaseAdapter {
  static check(url: string) {
    const urlObj = new URL(url);
    const host = urlObj.host;
    return host.includes(".hdslb.com");
  }

  urlRegulation(url: string): string {
    return url.split("@")[0];
  }

  public fakeReferer = "https://www.bilibili.com/";

  constructor(url: string, opts?: Partial<ConvertOptions>) {
    super(url, opts);
    const format = this.targetFormat;
    const { width, quality } = this.options;
    this.url += `@${width}w_1200h_0e_0c_${quality}q.${format}`;
  }
}
