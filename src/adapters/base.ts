type ConvertOptions = {
  width: number;
  quality: number;
};

export class BaseAdapter {
  static check(url: string) {
    throw new Error("Not implemented");
  }

  public userAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36";
  public options: ConvertOptions = {
    width: 200,
    quality: 50,
  };

  public url = "";
  public referer = "";
  public format = "jpg";

  constructor(
    url: string,
    accecpt?: string | null,
    opts?: Partial<ConvertOptions>
  ) {
    this.url = this.urlRegulation(url);
    this.format = this.targetFormat(accecpt ?? "");
    this.options = { ...this.options, ...(opts ?? {}) };
  }

  urlRegulation(url: string) {
    return url;
  }

  targetFormat(accept: string) {
    if (!accept) return "jpg";
    if (/image\/avif/.test(accept)) {
      return "avif";
    }
    if (/image\/webp/.test(accept)) {
      return "webp";
    }
    return "jpg";
  }

  cacheKey() {
    const { width, quality } = this.options;
    const format = this.format;
    return this.url + `/${width}/${quality}/${format}`;
  }

  fetch() {
    throw new Error("Not implemented");
  }
}
