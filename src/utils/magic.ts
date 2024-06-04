export const magicNumbers = {
  png: {
    signs: ['0,89504E470D0A1A0A'],
    mime: 'image/png',
  },
  jpg: {
    signs: ['0,FFD8'],
    mime: 'image/jpeg',
  },
  webp: {
    signs: ['0,52494646'],
    mime: 'image/webp',
  },
  bmp: {
    signs: ['0,424D'],
    mime: 'image/bmp',
  },
  gif: {
    signs: ['0,474946383961'],
    mime: 'image/gif',
  },
}

export const matchMagicNumber = (buffer: ArrayBuffer) => {
  const view = new DataView(buffer)
  for (const [ext, { signs, mime }] of Object.entries(magicNumbers)) {
    for (const sign of signs) {
      const [offset, hex] = sign.split(',')
      const bytes = hex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
      const match = bytes.every(
        (byte, i) => view.getUint8(+offset + i) === byte,
      )
      if (match) {
        return { ext, mime }
      }
    }
  }
  return null
}
