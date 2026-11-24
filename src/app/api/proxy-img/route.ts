import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { withEdgeCache } from '@/lib/edge-cache';
import { fetchUpstream } from '@/lib/fetch-utils';

export const runtime = 'nodejs';

const THIRTY_DAYS = 60 * 60 * 24 * 30;
const DOUBAN_HOST_RE = /\.doubanio\.com$/i;
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/**
 * GET /api/proxy-img?url=...
 * 转发外部苹果 CMS 返回的 http:// 或防盗链海报为 HTTPS，
 * 开启 Cloudflare caches.default 30 天边缘缓存，避免混合内容拦截和裂图。
 */
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const raw = new URL(req.url).searchParams.get('url')?.trim() || '';
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return NextResponse.json({ error: '图片地址不合法' }, { status: 400 });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return NextResponse.json({ error: '仅支持 http/https 图片' }, { status: 400 });
  }

  const cacheReq = new Request(req.url, { method: 'GET' });
  return withEdgeCache(cacheReq, THIRTY_DAYS, async () => {
    const headers: Record<string, string> = {
      'User-Agent': MOBILE_UA,
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      Referer: DOUBAN_HOST_RE.test(parsed.hostname)
        ? 'https://movie.douban.com/'
        : `${parsed.origin}/`,
    };
    try {
      const upstream = await fetchUpstream(parsed.href, {
        timeoutMs: 8000,
        headers,
      });
      if (!upstream.ok) {
        return new NextResponse(null, { status: 404 });
      }
      const contentType = upstream.headers.get('content-type') || 'image/jpeg';
      if (!contentType.startsWith('image/')) {
        return new NextResponse(null, { status: 404 });
      }
      const bytes = await upstream.arrayBuffer();
      return new NextResponse(bytes, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': `public, max-age=${THIRTY_DAYS}, immutable`,
        },
      });
    } catch {
      return new NextResponse(null, { status: 502 });
    }
  });
}
