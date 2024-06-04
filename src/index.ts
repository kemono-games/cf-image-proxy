import { Hono } from 'hono'

import { adapters } from './adapters'

type Bindings = {
  [key in keyof CloudflareBindings]: CloudflareBindings[key];
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", async ({ req, text, executionCtx }) => {
  const url = new URL(req.url);
  const params = url.searchParams;
  let imgUrl = params.get("url");
  const width = parseInt(params.get("w") ?? "200", 10);
  const quality = parseInt(params.get("q") ?? "65", 10);
  if (!imgUrl) return text("bad input");
  const accept = req.header("accept") ?? "";

  for (const Adapter of adapters) {
    if (!Adapter.check(imgUrl)) continue;
    const adapter = new Adapter(imgUrl, accept, { width, quality });
    const cacheKey = adapter.cacheKey();
    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    let response = await adapter.fetch();
    response = new Response(response.body, response);
    response.headers.set(
      "Cache-Control",
      "public, s-maxage=3153600, max-age=31536000, immutable"
    );
    executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  }
  return text("not supported");
});

export default app;
