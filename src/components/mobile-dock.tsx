'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Icon, type IconName } from './icon';
import { HistoryPanel } from './history-panel';
import { SourceManagerDrawer } from './source-manager';

/**
 * 移动端底部四栏导航（发现 / 直播 / 片库 / 设置）。
 *
 * 参考 MarcoMovie 手机端的移动端 Dock：固定底部、毛玻璃底、四等分、图标 + 小字，
 * 激活项用主色与顶部短横条标记。播放页不显示（全屏观看时不应被导航遮挡）。
 * 「片库」复用现有观看历史抽屉，「设置」复用源管理抽屉，不新增二级页面。
 */
export function MobileDock() {
  const pathname = usePathname();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 播放页是全屏体验，隐藏 Dock（同时避免误触返回打断播放）
  if (pathname.startsWith('/watch')) return null;

  return (
    <>
      <nav
        aria-label="主导航"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur-2xl lg:hidden"
      >
        <div className="mx-auto grid max-w-lg grid-cols-4 pb-[env(safe-area-inset-bottom)]">
          <DockLink href="/" active={pathname === '/'} icon="home" label="发现" />
          <DockLink href="/live" active={pathname.startsWith('/live')} icon="tv" label="直播" />
          <DockAction
            active={false}
            icon="grid"
            label="片库"
            onClick={() => setHistoryOpen(true)}
          />
          <DockAction
            active={false}
            icon="gear"
            label="设置"
            onClick={() => setSettingsOpen(true)}
          />
        </div>
      </nav>

      <HistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />
      <SourceManagerDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

function DockLink({
  href,
  active,
  icon,
  label,
}: {
  href: string;
  active: boolean;
  icon: IconName;
  label: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex flex-col items-center gap-1 py-2.5 transition-colors',
        active ? 'text-accent' : 'text-muted hover:text-content'
      )}
    >
      {active && (
        <span aria-hidden className="absolute top-0 h-0.5 w-7 rounded-full bg-accent" />
      )}
      <Icon name={icon} className="w-[22px] h-[22px]" />
      <span className={cn('text-[10px] leading-none', active && 'font-medium')}>{label}</span>
    </Link>
  );
}

function DockAction({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex flex-col items-center gap-1 py-2.5 transition-colors',
        active ? 'text-accent' : 'text-muted hover:text-content'
      )}
    >
      {active && (
        <span aria-hidden className="absolute top-0 h-0.5 w-7 rounded-full bg-accent" />
      )}
      <Icon name={icon} className="w-[22px] h-[22px]" />
      <span className={cn('text-[10px] leading-none', active && 'font-medium')}>{label}</span>
    </button>
  );
}
