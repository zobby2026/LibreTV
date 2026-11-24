import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';

export const runtime = 'nodejs';

const SIZES = new Set(['w342', 'w500', 'w780', 'original']);

/** 反代 TMDB 海报，避免国内手机直连 image.tmdb.org 裂图。 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ size: string; filename: string }> }
) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const { size, filename } = await params;
  if (!SIZES.has(size) || !/^[a-zA-Z0-9_-]+\.(jpg|png|webp)$/.test(filename)) {
    return NextResponse.json({ error: '图片地址不合法' }, { status: 400 });
  }

  const upstream = await fetch(`https://image.tmdb.org/t/p/${size}/${filename}`);
  if (!upstream.ok) {
    return new NextResponse(null, { status: 404 });
  }
  const bytes = await upstream.arrayBuffer();
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
      'Cache-Control': 'public, max-age=2592000, immutable',
    },
  });
}
