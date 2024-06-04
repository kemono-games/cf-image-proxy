import { fileTypeFromBuffer } from 'file-type'

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

type ImageData = {
  width: number
  height: number
  data: Uint8Array
}

export const decodeImage = async (buffer: ArrayBuffer, format?: string) => {
  let ext = format
  if (!ext) {
    const fileType = await fileTypeFromBuffer(buffer)
    if (!fileType) {
      throw new Error('Unknown file type')
    }
    ext = fileType.ext
  }
  if (ext === 'jpg') {
    await initJpegDecoderWasm(JPEG_DEC_WASM)
    return decodeJpeg(buffer)
  } else if (ext === 'png') {
    await initPngDecoderWasm(PNG_DEC_WASM)
    return decodePng(buffer)
  }
  throw new Error(`Unsupported format: ${ext}`)
}

export const transformImage = async (
  imageData: ImageData,
  targetFormat: string,
  options: { width: number; quality: number },
) => {
  await initResize(RESIZE_WASM)
  const { width, height } = imageData
  const { width: targetWidth, quality } = options

  imageData = await resize(imageData, {
    width: targetWidth,
    height: Math.round((targetWidth * height) / width),
  })
  if (targetFormat === 'webp') {
    await initWebpEncoderWasm(WEBP_ENC_WASM)
    const webpImage = await encodeWebp(imageData, { quality })
    return { image: webpImage, mime: 'image/webp' }
  }
  await initJpegEncoderWasm(JPEG_ENC_WASM)
  const jpegImage = await encodeJpeg(imageData, { quality })
  return { image: jpegImage, mime: 'image/jpeg' }
}
