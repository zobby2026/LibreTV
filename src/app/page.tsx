'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { CinemaHome } from '@/components/cinema-home';

/** 传统 ?s= 搜索页按需拆出独立 chunk，避免把旧版首页/详情/片源卡片打进首屏 JS */
const ClassicSearch = dynamic(
  () => import('@/components/classic-search').then((m) => m.ClassicSearch),
  { ssr: false }
);

export default function HomePage() {
  return (
    <Suspense>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get('s') || '';
  if (!urlQuery) return <CinemaHome />;
  return <ClassicSearch urlQuery={urlQuery} />;
}
