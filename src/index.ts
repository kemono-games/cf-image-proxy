import { Hono } from 'hono'

import { adapters } from './adapters'
import { isBlockedUrl } from './utils/blocklist'

type Bindings = {
  [key in keyof CloudflareBindings]: CloudflareBindings[key]
}

const CACHE_CONTROL = 'public, s-maxage=31536000, max-age=31536000, immutable'

const app = new Hono<{ Bindings: Bindings }>()

app.get('/', async ({ req, text, executionCtx, env }) => {
  const url = new URL(req.url)
  const params = url.searchParams
  let imgUrl = params.get('url')
  const width = parseInt(params.get('w') ?? '200', 10)
  const quality = parseInt(params.get('q') ?? '65', 10)
  if (!imgUrl) return text('bad input')
  try {
    // 必须在适配器和所有缓存读取之前检查，缓存命中也不能放行。
    if (isBlockedUrl(imgUrl)) {
      return text('image URL blocked', 403, { 'Cache-Control': 'no-store' })
    }
  } catch {
    return text('invalid image URL', 400, { 'Cache-Control': 'no-store' })
  }
  const accept = req.header('accept')
  const referer = req.header('referer')
  const userAgent = req.header('user-agent')

  for (const Adapter of adapters) {
    if (!Adapter.check(imgUrl, env)) continue
    const adapter = new Adapter(imgUrl, {
      accept,
      referer,
      userAgent,
      width,
      quality,
    })
    const cache = caches.default
    const cacheKey = adapter.cacheKey
    const useCache = env.NODE_ENV !== 'development'

    // L1：colo 缓存
    if (useCache) {
      const cached = await cache.match(cacheKey)
      if (cached) return cached
    }

    // L2：R2 持久缓存。colo 缓存按机房隔离且会被驱逐，immutable 内容
    // 反复未命中会重复走 WASM 转码烧 CPU；R2 命中只花流式读取的几 ms。
    const r2Key = cacheKey.replace(/^https?:\/\//, '')
    if (useCache) {
      const stored = await env.IMG_CACHE.get(r2Key)
      if (stored) {
        const response = new Response(stored.body, {
          headers: {
            'Content-Type':
              stored.httpMetadata?.contentType ?? 'application/octet-stream',
            'Cache-Control': CACHE_CONTROL,
            'x-img-cache': 'r2',
          },
        })
        executionCtx.waitUntil(cache.put(cacheKey, response.clone()))
        return response
      }
    }

    let response = await adapter.fetch()
    if (response.status !== 200) {
      return response
    }
    const body = await response.arrayBuffer()
    const headers = new Headers(response.headers)
    headers.set('Cache-Control', CACHE_CONTROL)
    headers.set('x-img-cache', 'miss')
    response = new Response(body, { status: 200, headers })
    if (useCache) {
      executionCtx.waitUntil(
        Promise.all([
          cache.put(cacheKey, response.clone()),
          env.IMG_CACHE.put(r2Key, body, {
            httpMetadata: {
              contentType: headers.get('Content-Type') ?? undefined,
              cacheControl: CACHE_CONTROL,
            },
          }),
        ]),
      )
    }
    return response
  }
  return text('not supported')
})

export default app
