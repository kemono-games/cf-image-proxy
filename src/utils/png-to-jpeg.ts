import decodePng, { init as initPng } from '@jsquash/png/decode'
import encodeJpeg, { init as initJpeg } from '@jsquash/jpeg/encode'
// @ts-ignore
import PNG_WASM from '../../node_modules/@jsquash/png/codec/pkg/squoosh_png_bg.wasm'
import JPEG_WASM from '../../node_modules/@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm'

export async function pngToJpeg(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  await initPng(PNG_WASM)
  const image = await decodePng(buffer)
  // JPEG has no alpha channel; composite transparency onto white.
  for (let i = 0; i < image.data.length; i += 4) {
    const alpha = image.data[i + 3] / 255
    for (let channel = 0; channel < 3; channel++) {
      image.data[i + channel] = Math.round(
        image.data[i + channel] * alpha + 255 * (1 - alpha),
      )
    }
    image.data[i + 3] = 255
  }
  await initJpeg(JPEG_WASM)
  return encodeJpeg(image, { quality: 90 })
}
