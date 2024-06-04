import { fileTypeFromBuffer } from 'file-type'
import { Bindings } from 'hono/types'

import decodeJpeg, { init as initJpegDecoderWasm } from '@jsquash/jpeg/decode'
import encodeJpeg, { init as initJpegEncoderWasm } from '@jsquash/jpeg/encode'
import decodePng, { init as initPngDecoderWasm } from '@jsquash/png/decode'
import resize, { initResize } from '@jsquash/resize'
import encodeWebp, { init as initWebpEncoderWasm } from '@jsquash/webp/encode'

import JPEG_DEC_WASM from '../../node_modules/@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm'
import JPEG_ENC_WASM from '../../node_modules/@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm'
import PNG_DEC_WASM from '../../node_modules/@jsquash/png/codec/pkg/squoosh_png_bg.wasm'
import RESIZE_WASM from '../../node_modules/@jsquash/resize/lib/resize/pkg/squoosh_resize_bg.wasm'
import WEBP_ENC_WASM from '../../node_modules/@jsquash/webp/codec/enc/webp_enc_simd.wasm'
import { BaseAdapter } from './base'

export class OthersAdapter extends BaseAdapter {
  public referer = "";

  static check(url: string, env?: CloudflareBindings) {
    const urlObj = new URL(url);
    const host = urlObj.host;
    const allowedHosts = env?.ALLOW_OTHER_HOSTS.split(",");
    if (!allowedHosts) return false;
    return allowedHosts.includes(host);
  }

  targetFormat(accept: string) {
    if (!accept) return "jpg";
    if (/image\/webp/.test(accept)) {
      return "webp";
    }
    return "jpg";
  }

  decodeImage = async (buffer: ArrayBuffer) => {
    const fileType = await fileTypeFromBuffer(buffer);
    if (!fileType) {
      throw new Error("Unknown file type");
    }
    const { ext } = fileType;
    if (ext === "jpg") {
      await initJpegDecoderWasm(JPEG_DEC_WASM);
      return decodeJpeg(buffer);
    } else if (ext === "png") {
      await initPngDecoderWasm(PNG_DEC_WASM);
      return decodePng(buffer);
    }
    throw new Error(`Unsupported format: ${ext}`);
  };

  async fetch() {
    const format = this.format;
    const { width: targetWidth, quality } = this.options;

    let response = await fetch(this.url, {
      headers: {
        referer: this.referer,
        "User-Agent": this.userAgent,
      },
    });
    if (response.status !== 200) {
      return response;
    }

    let imageData = await this.decodeImage(await response.arrayBuffer());
    await initResize(RESIZE_WASM);
    const { width, height } = imageData;
    imageData = await resize(imageData, {
      width: targetWidth,
      height: Math.round((targetWidth * height) / width),
    });
    if (format === "webp") {
      await initWebpEncoderWasm(WEBP_ENC_WASM);
      const webpImage = await encodeWebp(imageData, { quality });
      response = new Response(webpImage, response);
      response.headers.set("Content-Type", "image/webp");
    } else {
      await initJpegEncoderWasm(JPEG_ENC_WASM);
      const jpegImage = await encodeJpeg(imageData, { quality });
      response = new Response(jpegImage, response);
      response.headers.set("Content-Type", "image/jpeg");
    }
    return response;
  }
}
