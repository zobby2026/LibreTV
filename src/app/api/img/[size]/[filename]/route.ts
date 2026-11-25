import { NextResponse } from 'next/server';
import { withEdgeCache } from '@/lib/edge-cache';

export const runtime = 'nodejs';

const THIRTY_DAYS = 60 * 60 * 24 * 30;
const SIZES = new Set(['w342', 'w500', 'w780']);

/** 反代 TMDB 公开海报：严格校验尺寸与文件名格式，Cloudflare 边缘缓存 30 天，不要求登录态。 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ size: string; filename: string }> }
) {
  const { size: rawSize, filename } = await params;
  // 严禁加载 original 原图，老路径自动降级为 w780
  const size = rawSize === 'original' ? 'w780' : rawSize;
  if (!SIZES.has(size) || !/^[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(filename)) {
    return NextResponse.json({ error: '图片地址不合法' }, { status: 400 });
  }

  const cacheReq = new Request(req.url, { method: 'GET' });
  return withEdgeCache(cacheReq, THIRTY_DAYS, async () => {
    const upstream = await fetch(`https://image.tmdb.org/t/p/${size}/${filename}`);
    if (!upstream.ok) {
      return new NextResponse(null, { status: 404 });
    }
    const bytes = await upstream.arrayBuffer();
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
        'Cache-Control': `public, max-age=${THIRTY_DAYS}, immutable`,
      },
    });
  });
}
