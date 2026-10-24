'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ThemeToggle } from './theme';
import { SourceManagerDrawer } from './source-manager';
import { HistoryPanel } from './history-panel';
import { requestShowDownloadManager } from './download-manager';
import { Icon } from './icon';
import { SearchHistoryDropdown, useSearchHistory } from './search-history';
import { cn } from '@/lib/utils';

/**
 * 顶部导航：左侧标志与站名，紧凑搜索，右侧历史 / 设置 / 主题。
 * 首页把搜索放进顶栏，避免大搜索框独占首屏。
 * `syncQuery` 有值时与首页 `?s=` 对齐；清空或提交空串会回到发现页。
 */
export function Header({ showSearch = false, syncQuery }: { showSearch?: boolean; syncQuery?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [query, setQuery] = useState(syncQuery ?? '');
  // 与首页共用同一套「最近搜索」下拉
  const searchHistory = useSearchHistory(query);

  useEffect(() => {
    if (syncQuery !== undefined) setQuery(syncQuery);
  }, [syncQuery]);

  const submitSearch = (text: string) => {
    const q = text.trim().slice(0, 100);
    if (!q) {
      if (syncQuery) router.push('/', { scroll: false });
      return;
    }
    searchHistory.close();
    router.push(`/?s=${encodeURIComponent(q)}`);
    searchHistory.record(q);
  };

  const pickHistory = (text: string) => {
    setQuery(text);
    submitSearch(text);
  };

  const renderNav = () => (
    <HeaderNav
      pathname={pathname}
      onHistory={() => setHistoryOpen(true)}
      onSettings={() => setSettingsOpen(true)}
    />
  );

  return (
    <>
      <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur border-b border-line">
        <div className="max-w-6xl mx-auto px-4 py-2 md:h-14 md:py-0 flex flex-col md:flex-row md:items-center gap-2 md:gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Link href="/" aria-label="zobby的影视库 首页" className="flex items-center gap-2 shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/mark.svg" alt="" className="w-8 h-8 shrink-0" />
              <span className="font-semibold text-[13px] sm:text-base text-content tracking-tight whitespace-nowrap">
                zobby的影视库
              </span>
            </Link>
            <nav className="ml-auto flex md:hidden items-center gap-0.5 shrink-0">{renderNav()}</nav>
          </div>

          {showSearch && (
            <form
              className="w-full md:flex-1 md:max-w-xl md:mx-auto"
              onSubmit={(e) => {
                e.preventDefault();
                submitSearch(query);
              }}
            >
              <div ref={searchHistory.containerRef} className="relative">
                <div
                  className={cn(
                    'flex items-stretch h-9 pl-3 border bg-chip',
                    searchHistory.visible
                      ? 'rounded-t-lg rounded-b-none border-accent border-b-line bg-surface-raised'
                      : 'rounded-lg border-line focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/40'
                  )}
                >
                  <Icon name="search" className="w-4 h-4 self-center text-faint shrink-0" />
                  <input
                    className="flex-1 min-w-0 px-2 bg-transparent text-sm text-content placeholder:text-faint focus:outline-none"
                    aria-label="搜索影片"
                    placeholder="搜索影片"
                    value={query}
                    maxLength={100}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      searchHistory.resetActive();
                    }}
                    onFocus={searchHistory.onFocus}
                    onKeyDown={(e) => searchHistory.onKeyDown(e, pickHistory)}
                    role="combobox"
                    aria-expanded={searchHistory.visible}
                    aria-controls="header-search-history"
                    aria-autocomplete="list"
                    aria-activedescendant={
                      searchHistory.visible && searchHistory.activeIndex >= 0
                        ? `header-search-history-${searchHistory.activeIndex}`
                        : undefined
                    }
                  />
                  {query && (
                    <button
                      type="button"
                      className="shrink-0 self-center p-1.5 rounded-full text-faint hover:text-content hover:bg-hover transition-colors"
                      aria-label="清空"
                      onClick={() => {
                        setQuery('');
                        searchHistory.resetActive();
                        if (syncQuery) router.push('/', { scroll: false });
                      }}
                    >
                      <Icon name="close" className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    type="submit"
                    className={cn(
                      'btn-primary shrink-0 px-3 text-sm font-medium !rounded-l-none',
                      searchHistory.visible ? '!rounded-tr-lg !rounded-br-none' : '!rounded-r-lg'
                    )}
                  >
                    搜索
                  </button>
                </div>
                {searchHistory.visible && (
                  <SearchHistoryDropdown
                    id="header-search-history"
                    matches={searchHistory.matches}
                    activeIndex={searchHistory.activeIndex}
                    onPick={pickHistory}
                    onRemove={searchHistory.remove}
                    onClearAll={searchHistory.clearAll}
                  />
                )}
              </div>
            </form>
          )}

          <nav className="hidden md:flex items-center gap-0.5 ml-auto shrink-0">{renderNav()}</nav>
        </div>
      </header>

      <SourceManagerDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <HistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </>
  );
}

function HeaderNav({
  pathname,
  onHistory,
  onSettings,
}: {
  pathname: string;
  onHistory: () => void;
  onSettings: () => void;
}) {
  return (
    <>
      <HeaderLink href="/live" active={pathname === '/live'}>
        直播
      </HeaderLink>
      <HeaderLink href="/about" active={pathname === '/about'} className="hidden sm:inline-flex">
        关于
      </HeaderLink>
      <ThemeToggle />
      <IconButton label="观看历史" onClick={onHistory}>
        <Icon name="clock" />
      </IconButton>
      <IconButton label="下载管理" onClick={requestShowDownloadManager} className="max-[359px]:hidden">
        <Icon name="download" />
      </IconButton>
      <IconButton label="设置" onClick={onSettings}>
        <Icon name="gear" />
      </IconButton>
    </>
  );
}

function HeaderLink({
  href,
  active,
  className,
  children,
}: {
  href: string;
  active: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'px-2 py-1.5 rounded-md text-sm transition-colors',
        active ? 'text-content bg-hover' : 'text-muted hover:text-content',
        className
      )}
    >
      {children}
    </Link>
  );
}

function IconButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      className={cn(
        'p-1.5 sm:p-2 rounded-md text-muted hover:text-content hover:bg-hover transition-colors',
        className
      )}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
