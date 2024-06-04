export type ConvertOptions = {
  width: number;
  quality: number;
  referer?: string;
  accept?: string;
  userAgent?: string;
  env?: CloudflareBindings;
};

export class BaseAdapter {
  static check(url: string, env?: CloudflareBindings) {
    throw new Error("Not implemented");
  }

  public fakeUserAgent?: string;
  public fakeReferer?: string;

  public options: ConvertOptions = {
    width: 200,
    quality: 50,
  };

  public url = "";

  constructor(url: string, opts?: Partial<ConvertOptions>) {
    this.url = this.urlRegulation(url);
    this.options = { ...this.options, ...opts };
  }

  urlRegulation(url: string) {
    return url;
  }

  get targetFormat() {
    const { accept } = this.options;
    if (!accept) return "jpg";
    if (/image\/avif/.test(accept)) {
      return "avif";
    }
    if (/image\/webp/.test(accept)) {
      return "webp";
    }
    return "jpg";
  }

  get cacheKey() {
    const { width, quality } = this.options;
    const format = this.targetFormat;
    return this.url + `/${width}/${quality}/${format}`;
  }

  async postProcess(response: Response) {
    return response;
  }

  async fetch() {
    let response = await fetch(this.url, {
      headers: {
        referer: this.fakeReferer ?? this.options.referer ?? "",
        "User-Agent": this.fakeUserAgent ?? this.options.userAgent ?? "",
      },
    });
    if (response.status !== 200) {
      return new Response("fetch image failed.", { status: response.status });
    }

    response = await this.postProcess(response);
    return response;
  }
}
