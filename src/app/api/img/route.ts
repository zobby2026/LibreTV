import { NextResponse } from 'next/server';
import { withEdgeCache } from '@/lib/edge-cache';

export const runtime = 'nodejs';

const THIRTY_DAYS = 60 * 60 * 24 * 30;
const DOUBAN_HOST_RE = /^img\d+\.doubanio\.com$/i;
const TMDB_HOST_RE = /^image\.tmdb\.org$/i;
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/**
 * GET /api/img?url=...
 * 专门反代公开影视海报（仅白名单 img*.doubanio.com 与 image.tmdb.org），
 * 写入 Cloudflare caches.default 边缘缓存 30 天，不要求登录态以便跨用户共享边缘缓存。
 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('url')?.trim() || '';
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return NextResponse.json({ error: '图片地址不合法' }, { status: 400 });
  }

  const isDouban = DOUBAN_HOST_RE.test(parsed.hostname);
  const isTmdb = TMDB_HOST_RE.test(parsed.hostname);
  if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || (!isDouban && !isTmdb)) {
    return NextResponse.json({ error: '不支持的图片域名' }, { status: 400 });
  }

  // 强制升级为 HTTPS，避免上游明文重定向
  parsed.protocol = 'https:';
  // 严禁加载 TMDB original 原图
  if (isTmdb && parsed.pathname.includes('/t/p/original/')) {
    parsed.pathname = parsed.pathname.replace('/t/p/original/', '/t/p/w780/');
  }

  const cacheReq = new Request(req.url, { method: 'GET' });
  return withEdgeCache(cacheReq, THIRTY_DAYS, async () => {
    const headers: Record<string, string> = {
      'User-Agent': MOBILE_UA,
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    };
    if (isDouban) {
      headers.Referer = 'https://movie.douban.com/';
    }
    const upstream = await fetch(parsed.href, { headers });
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
  });
}
