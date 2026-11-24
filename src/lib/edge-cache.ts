/** Cloudflare Cache API。本地 Node 没有 caches.default 时直接跳过，不抛错。 */
function cacheStore(): Cache | undefined {
  try {
    return (globalThis as { caches?: { default?: Cache } }).caches?.default;
  } catch {
    return undefined;
  }
}

export async function withEdgeCache(
  request: Request,
  ttlSeconds: number,
  loader: () => Promise<Response>
): Promise<Response> {
  const cache = cacheStore();
  if (cache) {
    const hit = await cache.match(request).catch(() => undefined);
    if (hit) return hit;
  }
  const fresh = await loader();
  const headers = new Headers(fresh.headers);
  if (!headers.has('Cache-Control')) {
    headers.set('Cache-Control', `public, max-age=${ttlSeconds}`);
  }
  const body = await fresh.arrayBuffer();
  const response = new Response(body, { status: fresh.status, headers });
  if (cache && fresh.ok) {
    await cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}
