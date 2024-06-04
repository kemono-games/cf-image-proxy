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

export class PixivAdapter extends BaseAdapter {
  static check(url: string) {
    const urlObj = new URL(url);
    const host = urlObj.host;
    return host.includes(".pximg.net");
  }

  public fakeReferer = "https://www.pixiv.net/";

  get targetFormat() {
    const { accept } = this.options;
    if (!accept) return "jpg";
    if (/image\/webp/.test(accept)) {
      return "webp";
    }
    return "jpg";
  }

  decodeImage = async (buffer: ArrayBuffer, format: string) => {
    if (format === "jpeg" || format === "jpg") {
      // @Note, we need to manually initialise the wasm module here from wasm import at top of file
      await initJpegDecoderWasm(JPEG_DEC_WASM);
      return decodeJpeg(buffer);
    } else if (format === "png") {
      // @Note, we need to manually initialise the wasm module here from wasm import at top of file
      await initPngDecoderWasm(PNG_DEC_WASM);
      return decodePng(buffer);
    }
    throw new Error(`Unsupported format: ${format}`);
  };

  async postProcess(response: Response) {
    const format = this.format;
    const { width: targetWidth, quality } = this.options;

    await initJpegDecoderWasm(JPEG_DEC_WASM);
    const origImageFormat = this.url.split(".").pop();
    let imageData = await this.decodeImage(
      await response.arrayBuffer(),
      origImageFormat ?? "jpg"
    );
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
