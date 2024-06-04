import { BaseAdapter } from './base'

export class BilibiliCDNAdapter extends BaseAdapter {
  static check(url: string) {
    return url.includes(".hdslb.com");
  }

  urlRegulation(url: string): string {
    return url.split("@")[0];
  }

  public referer = "https://www.bilibili.com/";

  fetch() {
    const format = this.format;
    const { width, quality } = this.options;

    const requestUrl =
      this.url + `@${width}w_1200h_0e_0c_${quality}q.${format}`;

    return fetch(requestUrl, {
      headers: {
        referer: this.referer,
        "User-Agent": this.userAgent,
      },
    });
  }
}
