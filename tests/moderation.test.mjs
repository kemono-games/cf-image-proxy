import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { pixivModerationSource } from '../src/utils/pixiv-source.ts'
const require = createRequire(import.meta.url)
const { build } = createRequire(require.resolve('wrangler/package.json'))(
  'esbuild',
)
const moduleDir = await mkdtemp(join(tmpdir(), 'moderation-test-'))
after(() => rm(moduleDir, { recursive: true, force: true }))
await build({
  entryPoints: ['src/moderation.ts'],
  bundle: true,
  format: 'esm',
  outfile: join(moduleDir, 'moderation.mjs'),
  logLevel: 'silent',
})
const { moderatePixiv, parseResponse, isRejected, MODERATION_TTL } =
  await import(pathToFileURL(join(moduleDir, 'moderation.mjs')).href)
const thumbnail = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])

test('Pixiv originals and CDN variants normalize to one fixed thumbnail', () => {
  const expected =
    'https://i.pximg.net/c/600x1200_90/img-master/img/2026/01/01/00/00/00/123_p0_master1200.jpg'
  for (const value of [
    'https://i.pximg.net/img-original/img/2026/01/01/00/00/00/123_p0.png',
    'https://i.pximg.net/c/250x250_80_a2/img-master/img/2026/01/01/00/00/00/123_p0_master1200.jpg',
    'https://i.pximg.net/c/360x360_70/img-square/img/2026/01/01/00/00/00/123_p0_square1200.jpg',
    expected,
  ])
    assert.equal(pixivModerationSource(value), expected)
  const novel =
    'https://i.pximg.net/novel-cover-original/img/2026/01/01/00/00/00/ci123_hash.png'
  assert.equal(
    pixivModerationSource(novel),
    'https://i.pximg.net/c/600x1200_90/novel-cover-master/img/2026/01/01/00/00/00/ci123_hash_master1200.jpg',
  )
  assert.throws(() =>
    pixivModerationSource('https://i.pximg.net.evil.test/img-original/a.jpg'),
  )
})

const response = (scores = [80]) => ({
  Code: 200,
  RequestId: 'test-id',
  Data: {
    Result: scores.map((Confidence) => ({ Label: 'test_label', Confidence })),
  },
})
const encode = (value) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )

function fixture(t, payload = response()) {
  const records = new Map()
  const writes = []
  const requests = []
  const allRequests = []
  const env = {
    ALIYUN_ACCESS_KEY_ID: 'test-key',
    ALIYUN_ACCESS_KEY_SECRET: 'test-secret',
    ALIYUN_MODERATION_REGION: 'cn-shanghai',
    ALIYUN_MODERATION_SERVICE: 'postImageCheckByVL_ec_01',
    PIXIV_MODERATION: {
      get: async (key) => records.get(key) ?? null,
      put: async (key, value, options) => {
        writes.push({ key, options })
        records.set(key, JSON.parse(value))
      },
    },
  }
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    allRequests.push({ url, init })
    if (new URL(url).hostname.endsWith('.pximg.net')) {
      return new Response(thumbnail, {
        headers: { 'Content-Type': 'image/jpeg' },
      })
    }
    if (init.method === 'PUT') return new Response(null, { status: 200 })
    if (
      new URLSearchParams(init.body).get('Action') === 'DescribeUploadToken'
    ) {
      return Response.json({
        Code: 200,
        Data: {
          AccessKeyId: 'sts-key',
          AccessKeySecret: 'sts-secret',
          SecurityToken: 'sts-token',
          BucketName: 'test-bucket',
          FileNamePrefix: 'upload/',
          OssInternetEndPoint: 'oss-cn-shanghai.aliyuncs.com',
        },
      })
    }
    requests.push({ url, init })
    return Response.json(payload)
  })
  return { env, records, writes, requests, allRequests }
}

test('strict >80 threshold across every label, including numeric nonLabel scores', () => {
  assert.equal(
    isRejected(parseResponse(response([0, 79.99, 80])).results),
    false,
  )
  assert.equal(isRejected(parseResponse(response([10, 80.01])).results), true)
  assert.equal(isRejected([{ Label: 'nonLabel_lib', Confidence: 99 }]), true)
  assert.equal(
    isRejected([{ Label: 'nonLabel' }, { Label: 'test', Confidence: null }]),
    false,
  )
})

test('invalid or unsuccessful provider responses do not become approvals', () => {
  for (const value of [
    null,
    {},
    { Code: 408 },
    response([]),
    response(['90']),
    response([101]),
  ]) {
    assert.throws(() => parseResponse(value))
  }
  const value = response([10])
  value.Data.Frame = JSON.stringify([
    { Result: [{ Label: 'frame', Confidence: 95 }] },
  ])
  assert.equal(isRejected(parseResponse(value).results), true)
})

test('signed request, six-month TTL, fragment normalization and cache reuse', async (t) => {
  const f = fixture(t)
  const url = 'https://i.pximg.net/test.jpg?a=1&b=2'
  assert.equal(await moderatePixiv(url, f.env), true)
  assert.equal(await moderatePixiv(`${url}#fragment`, f.env), true)
  assert.equal(f.requests.length, 1)
  assert.equal(f.writes.length, 1)
  assert.equal(f.writes[0].options.expirationTtl, 15552000)
  const { url: endpoint, init } = f.requests[0]
  assert.equal(endpoint, 'https://green-cip.cn-shanghai.aliyuncs.com/')
  assert.equal(init.method, 'POST')
  const params = new URLSearchParams(init.body)
  const signature = params.get('Signature')
  params.delete('Signature')
  const canonical = [...params]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${encode(key)}=${encode(value)}`)
    .join('&')
  assert.equal(
    signature,
    createHmac('sha1', 'test-secret&')
      .update(`POST&%2F&${encode(canonical)}`)
      .digest('base64'),
  )
  assert.equal(params.get('Service'), 'postImageCheckByVL_ec_01')
  const business = JSON.parse(params.get('ServiceParameters'))
  assert.equal(business.imageUrl, undefined)
  assert.equal(business.ossBucketName, 'test-bucket')
  assert.match(business.ossObjectName, /^upload\/.+\.jpg$/)
  assert.equal(f.allRequests.length, 4)
  assert.equal(
    f.allRequests[0].url,
    'https://i.pximg.net/c/600x1200_90/test.jpg?a=1&b=2',
  )
  assert.equal(f.allRequests[0].init.headers.Referer, 'https://www.pixiv.net/')
  const upload = f.allRequests.find((r) => r.init.method === 'PUT')
  assert.deepEqual(new Uint8Array(upload.init.body), thumbnail)
  const canonicalOss = `PUT\n\nimage/jpeg\n${upload.init.headers.Date}\nx-oss-security-token:sts-token\n/test-bucket/${business.ossObjectName}`
  assert.equal(
    upload.init.headers.Authorization,
    'OSS sts-key:' +
      createHmac('sha1', 'sts-secret').update(canonicalOss).digest('base64'),
  )
})

test('blocked results are cached; expired records trigger a new audit', async (t) => {
  const f = fixture(t, response([90]))
  assert.equal(await moderatePixiv('https://i.pximg.net/a.jpg', f.env), false)
  assert.equal(await moderatePixiv('https://i.pximg.net/a.jpg', f.env), false)
  assert.equal(f.requests.length, 1)
  f.records.values().next().value.checkedAt -= MODERATION_TTL * 1000
  assert.equal(await moderatePixiv('https://i.pximg.net/a.jpg', f.env), false)
  assert.equal(f.requests.length, 2)
})

test('rule changes use a separate cache key; malformed records are reaudited', async (t) => {
  const f = fixture(t)
  await moderatePixiv('https://i.pximg.net/a.jpg', f.env)
  f.records.values().next().value.results = []
  await moderatePixiv('https://i.pximg.net/a.jpg', f.env)
  await moderatePixiv('https://i.pximg.net/a.jpg', {
    ...f.env,
    ALIYUN_MODERATION_SERVICE: 'new-rule',
  })
  assert.equal(f.requests.length, 3)
  assert.equal(f.records.size, 2)
})

test('API errors and network failures are not cached', async (t) => {
  const f = fixture(t, { Code: 408 })
  await assert.rejects(moderatePixiv('https://i.pximg.net/a.jpg', f.env))
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('network failure')
  })
  await assert.rejects(moderatePixiv('https://i.pximg.net/a.jpg', f.env))
  assert.equal(f.writes.length, 0)
})

test('CDN size and quality variants share a single KV record and upload', async (t) => {
  const f = fixture(t)
  for (const size of ['480x960', '600x600', '600x1200_90']) {
    assert.equal(
      await moderatePixiv(
        `https://i.pximg.net/c/${size}/novel-cover-master/img/2026/01/01/00/00/00/ci123_hash_master1200.jpg`,
        f.env,
      ),
      true,
    )
  }
  assert.equal(f.records.size, 1)
  assert.equal(f.allRequests.length, 4)
})

test('thumbnail errors never fall back to original uploads or cache approval', async (t) => {
  const f = fixture(t)
  for (const reply of [
    () => new Response('not found', { status: 404 }),
    () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } }),
    () =>
      new Response('not jpeg', { headers: { 'Content-Type': 'image/jpeg' } }),
  ]) {
    let calls = 0
    t.mock.method(globalThis, 'fetch', async (url) => {
      calls++
      assert.match(url, /\/c\/600x1200_90\//)
      return reply()
    })
    await assert.rejects(
      moderatePixiv('https://i.pximg.net/img-original/a.png', f.env),
    )
    assert.equal(calls, 1)
  }
  assert.equal(f.writes.length, 0)
})

test('Worker gates L1/R2, shares approval across variants, leaves other sources alone', async (t) => {
  // Use the same esbuild version already installed as Wrangler's dependency.
  const require = createRequire(import.meta.url)
  const wranglerRequire = createRequire(
    require.resolve('wrangler/package.json'),
  )
  const { build } = wranglerRequire('esbuild')
  const directory = await mkdtemp(join(tmpdir(), 'image-proxy-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const outfile = join(directory, 'worker.mjs')
  await build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    format: 'esm',
    loader: { '.wasm': 'binary' },
    outfile,
    logLevel: 'silent',
  })
  const { default: app } = await import(pathToFileURL(outfile).href)
  let cacheReads = 0
  let r2Reads = 0
  let hitL1 = true
  const previousCaches = globalThis.caches
  globalThis.caches = {
    default: {
      match: async () => {
        cacheReads++
        return hitL1 ? new Response('cached') : undefined
      },
      put: async () => {},
    },
  }
  t.after(() => {
    globalThis.caches = previousCaches
  })
  const f = fixture(t, response([90]))
  f.env.IMG_CACHE = {
    get: async () => {
      r2Reads++
      return { body: 'stored', httpMetadata: { contentType: 'image/jpeg' } }
    },
  }
  f.env.ALLOW_OTHER_HOSTS = 'img.kemono.games'
  const ctx = { waitUntil: () => {} }
  const request = (source) =>
    app.request(
      `https://proxy.test/?url=${encodeURIComponent(source)}`,
      {},
      f.env,
      ctx,
    )
  let res = await request('https://i.pximg.net/a.jpg')
  assert.equal(res.status, 403)
  assert.equal(res.headers.get('Cache-Control'), 'no-store')
  assert.equal(cacheReads, 0)
  assert.equal(r2Reads, 0)
  const record = f.records.values().next().value
  record.results = [{ Label: 'test', Confidence: 80 }]
  res = await request('https://i.pximg.net/a.jpg')
  assert.equal(await res.text(), 'cached')
  assert.equal(res.headers.get('Cache-Control'), 'private, no-store')
  hitL1 = false
  res = await app.request(
    'https://proxy.test/?url=https://i.pximg.net/a.jpg&w=800&q=90',
    { headers: { Accept: 'image/webp' } },
    f.env,
    ctx,
  )
  assert.equal(await res.text(), 'stored')
  assert.equal(res.headers.get('Cache-Control'), 'private, no-store')
  assert.equal(f.requests.length, 1)
  hitL1 = true
  for (const source of [
    'https://i0.hdslb.com/a.jpg',
    'https://img.kemono.games/a.jpg',
  ]) {
    res = await request(source)
    assert.equal(await res.text(), 'cached')
  }
  assert.equal(f.requests.length, 1)
  t.mock.method(globalThis, 'fetch', async () => Response.json({ Code: 408 }))
  const before = cacheReads
  res = await request('https://i.pximg.net/new.jpg')
  assert.equal(res.status, 503)
  assert.equal(cacheReads, before)
})
