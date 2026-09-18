import {
  fetchPixivThumbnail,
  pixivModerationSource,
  PIXIV_MODERATION_PROFILE,
} from './utils/pixiv-source'

export const MODERATION_TTL = 180 * 24 * 60 * 60
export const MODERATION_THRESHOLD = 80

type Detection = { Label: string; Confidence?: number | null }
type RecordData = {
  version: 1
  checkedAt: number
  requestId: string
  results: Detection[]
}

export type ModerationEnv = Pick<
  CloudflareBindings,
  'PIXIV_MODERATION' | 'ALIYUN_MODERATION_REGION' | 'ALIYUN_MODERATION_SERVICE'
> & {
  ALIYUN_ACCESS_KEY_ID: string
  ALIYUN_ACCESS_KEY_SECRET: string
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function parseResults(value: unknown): Detection[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Missing moderation results')
  }
  return value.map((item: unknown) => {
    if (!object(item) || typeof item.Label !== 'string' || !item.Label) {
      throw new Error('Invalid moderation label')
    }
    const score = item.Confidence
    if (
      score !== undefined &&
      score !== null &&
      (typeof score !== 'number' ||
        !Number.isFinite(score) ||
        score < 0 ||
        score > 100)
    ) {
      throw new Error('Invalid moderation confidence')
    }
    return {
      Label: item.Label,
      ...(score !== undefined ? { Confidence: score as number | null } : {}),
    }
  })
}

export function parseResponse(value: unknown): RecordData {
  if (
    !object(value) ||
    value.Code !== 200 ||
    !object(value.Data) ||
    typeof value.RequestId !== 'string' ||
    !value.RequestId
  ) {
    // Never include provider messages or signed URLs in errors/logs.
    throw new Error('Moderation API returned an unsuccessful response')
  }
  const results = parseResults(value.Data.Result)
  if (value.Data.Frame !== undefined && value.Data.Frame !== null) {
    const frames: unknown =
      typeof value.Data.Frame === 'string'
        ? JSON.parse(value.Data.Frame)
        : value.Data.Frame
    if (!Array.isArray(frames)) throw new Error('Invalid moderation frames')
    for (const frame of frames) {
      if (!object(frame)) throw new Error('Invalid moderation frame')
      results.push(...parseResults(frame.Result))
    }
  }
  return {
    version: 1,
    checkedAt: Date.now(),
    requestId: value.RequestId,
    results,
  }
}

export function isRejected(results: Detection[]): boolean {
  return results.some(
    (item) =>
      typeof item.Confidence === 'number' &&
      item.Confidence > MODERATION_THRESHOLD,
  )
}

const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )

async function hmac(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )
  const bytes = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
}

async function callAliyun(
  action: 'ImageModeration' | 'DescribeUploadToken',
  business: Record<string, string>,
  env: Omit<ModerationEnv, 'PIXIV_MODERATION'>,
): Promise<unknown> {
  if (
    !env.ALIYUN_ACCESS_KEY_ID ||
    !env.ALIYUN_ACCESS_KEY_SECRET ||
    !/^[a-z0-9-]+$/.test(env.ALIYUN_MODERATION_REGION) ||
    !env.ALIYUN_MODERATION_SERVICE
  ) {
    throw new Error('Moderation is not configured')
  }
  const params: Record<string, string> = {
    Format: 'JSON',
    Version: '2022-03-02',
    Action: action,
    AccessKeyId: env.ALIYUN_ACCESS_KEY_ID,
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: crypto.randomUUID(),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    ...business,
  }
  const query = Object.keys(params)
    .sort()
    .map((key) => `${encode(key)}=${encode(params[key])}`)
    .join('&')
  const signature = await hmac(
    `${env.ALIYUN_ACCESS_KEY_SECRET}&`,
    `POST&%2F&${encode(query)}`,
  )
  const response = await fetch(
    `https://green-cip.${env.ALIYUN_MODERATION_REGION}.aliyuncs.com/`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `${query}&Signature=${encode(signature)}`,
      signal: AbortSignal.timeout(15000),
    },
  )
  if (!response.ok) throw new Error(`Moderation HTTP ${response.status}`)
  return response.json()
}

export async function requestModeration(
  thumbnailUrl: string,
  env: Omit<ModerationEnv, 'PIXIV_MODERATION'>,
): Promise<RecordData> {
  // Fetch only the fixed CDN thumbnail. No WASM decode, resize, or original fallback.
  const image = await fetchPixivThumbnail(pixivModerationSource(thumbnailUrl))
  const response = await callAliyun('DescribeUploadToken', {}, env)
  if (!object(response) || response.Code !== 200 || !object(response.Data)) {
    throw new Error('Cannot obtain moderation upload token')
  }
  const token = response.Data
  const string = (name: string): string => {
    const value = token[name]
    if (typeof value !== 'string' || !value)
      throw new Error('Invalid upload token')
    return value
  }
  const bucket = string('BucketName')
  const endpoint = new URL(
    `https://${string('OssInternetEndPoint').replace(/^https?:\/\//, '')}`,
  )
  if (
    !/^[a-z0-9-]+$/.test(bucket) ||
    !endpoint.hostname.endsWith('.aliyuncs.com') ||
    endpoint.username ||
    endpoint.password ||
    endpoint.port ||
    endpoint.pathname !== '/' ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error('Invalid OSS endpoint')
  }
  const objectName = `${string('FileNamePrefix')}${crypto.randomUUID()}.jpg`
  const date = new Date().toUTCString()
  const securityToken = string('SecurityToken')
  const signature = await hmac(
    string('AccessKeySecret'),
    `PUT\n\nimage/jpeg\n${date}\nx-oss-security-token:${securityToken}\n/${bucket}/${objectName}`,
  )
  endpoint.hostname = `${bucket}.${endpoint.hostname}`
  endpoint.pathname = '/' + objectName.split('/').map(encode).join('/')
  const upload = await fetch(endpoint.href, {
    method: 'PUT',
    headers: {
      'Content-Type': 'image/jpeg',
      Date: date,
      'x-oss-security-token': securityToken,
      Authorization: `OSS ${string('AccessKeyId')}:${signature}`,
    },
    body: image,
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
  })
  await upload.body?.cancel()
  if (!upload.ok) throw new Error(`Moderation upload HTTP ${upload.status}`)
  return parseResponse(
    await callAliyun(
      'ImageModeration',
      {
        Service: env.ALIYUN_MODERATION_SERVICE,
        ServiceParameters: JSON.stringify({
          ossBucketName: bucket,
          ossObjectName: objectName,
          dataId: crypto.randomUUID(),
        }),
      },
      env,
    ),
  )
}

export async function moderatePixiv(
  imageUrl: string,
  env: ModerationEnv,
): Promise<boolean> {
  const source = pixivModerationSource(imageUrl)
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(source),
  )
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  const key = `pixiv:v2:${PIXIV_MODERATION_PROFILE}:${env.ALIYUN_MODERATION_REGION}:${env.ALIYUN_MODERATION_SERVICE}:${hash}`
  const cached = await env.PIXIV_MODERATION.get<unknown>(key, 'json')
  if (
    object(cached) &&
    cached.version === 1 &&
    typeof cached.checkedAt === 'number' &&
    cached.checkedAt <= Date.now() &&
    Date.now() - cached.checkedAt < MODERATION_TTL * 1000 &&
    typeof cached.requestId === 'string'
  ) {
    try {
      return !isRejected(parseResults(cached.results))
    } catch {
      // Malformed records must be audited again, never treated as approval.
    }
  }
  const result = await requestModeration(source, env)
  await env.PIXIV_MODERATION.put(key, JSON.stringify(result), {
    expirationTtl: MODERATION_TTL,
  })
  return !isRejected(result.results)
}
