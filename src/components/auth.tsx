'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, onUnauthorized, STATUS_QUERY_KEY } from '@/lib/client-api';
import { applyEnvPresets } from '@/lib/subscription-sync';
import { detachUserData, flushUserData, hydrateUserData } from '@/lib/user-data-sync';
import { SITE_NAME } from '@/lib/brand';
import type { AuthStatusResponse } from '@/lib/types';
import type { PublicUser } from '@/lib/user-types';
import { useToast } from './toast';

/**
 * 认证上下文：
 * - 页面加载时查询 /api/status 判断会话有效性，并拿到当前用户；
 * - 任何 API 返回 401/503 时全局打开登录框（客户端 API 层统一触发，不再散落检查）。
 *
 * 多用户版新增：`user`（页头显示账号、设置页判断是否是管理员）、
 * `register` 走一次性邀请码，登录框内直接切换。
 */

interface AuthContextValue {
  checked: boolean;
  verified: boolean;
  /** 当前登录用户；未登录为 null */
  user: PublicUser | null;
  /** 是否管理员（管理邀请码、共享源） */
  isAdmin: boolean;
  /** 服务端还没有任何账号，需要管理员先设置 PASSWORD 完成初始化 */
  setupRequired: boolean;
  /** 只有一个账号：登录框预填用户名，兼容从单密码版升级的用户 */
  singleUser: boolean;
  /** /api/status 返回的应用版本（构建时从 package.json 注入） */
  version: string | null;
  openLogin: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  checked: false,
  verified: false,
  user: null,
  isAdmin: false,
  setupRequired: false,
  singleUser: false,
  version: null,
  openLogin: () => {},
  logout: async () => {},
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [checked, setChecked] = useState(false);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [singleUser, setSingleUser] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const applyStatus = useCallback((s: AuthStatusResponse) => {
    setUser(s.user ?? null);
    setSetupRequired(Boolean(s.setupRequired));
    setSingleUser(Boolean(s.legacyPasswordMode));
    setVersion(s.version);
  }, []);

  // 与 Providers 共用同一 query key 与缓存，避免 /api/status 被请求两次
  useEffect(() => {
    let cancelled = false;
    queryClient
      .fetchQuery({ queryKey: STATUS_QUERY_KEY, queryFn: () => api.status() })
      .then((s) => {
        if (cancelled) return;
        applyStatus(s);
        setChecked(true);
        // 会话还在：把该账号的个人数据拉回来（收藏、历史、偏好、片头标记……）
        if (s.user) void hydrateUserData(s.user.id, s.user.role);
      })
      .catch(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [queryClient, applyStatus]);

  useEffect(
    () =>
      onUnauthorized((event) => {
        const setup = (event as CustomEvent).detail === 'setup';
        if (setup) setSetupRequired(true);
        setUser(null);
        setModalOpen(true);
      }),
    []
  );

  const openLogin = useCallback(() => setModalOpen(true), []);

  const logout = useCallback(async () => {
    try {
      // 先把待发的改动推上去，再断开会话——否则刚看的那一集进度会停在 5s 防抖里
      await flushUserData();
      await api.logout();
    } finally {
      detachUserData();
      setUser(null);
      // 换账号后旧的查询结果（依赖身份的接口）全部作废
      queryClient.invalidateQueries();
      toast('已退出登录', 'info');
    }
  }, [toast, queryClient]);

  const handleLoginSuccess = useCallback(
    async (nextUser: PublicUser) => {
      setUser(nextUser);
      setSetupRequired(false);
      setModalOpen(false);
      // 登录前以 401 失败的查询（如豆瓣推荐）需要重新拉取
      queryClient.invalidateQueries();
      toast(`欢迎，${nextUser.username}`, 'success');
      // 个人数据先落地（换设备登录时这里会把服务端的收藏/历史/偏好恢复回来），
      // 再跑预置源——预置源的勾选合并要建立在恢复好的个人状态之上，顺序不能反。
      try {
        await hydrateUserData(nextUser.id, nextUser.role);
      } catch {
        // 个人数据拉取失败不阻塞进入站点
      }
      // 预置订阅（DEFAULT_SUBSCRIPTIONS）的首屏同步发生在登录之前，会 401 静默失败，
      // 这里用缓存中的 /api/status 补跑一次（缓存缺失时回落为一次请求）
      try {
        const cached = queryClient.getQueryData<AuthStatusResponse>(STATUS_QUERY_KEY);
        const status =
          cached ??
          (await queryClient.fetchQuery<AuthStatusResponse>({
            queryKey: STATUS_QUERY_KEY,
            queryFn: () => api.status(),
            staleTime: 0,
          }));
        if (status) await applyEnvPresets(status, { verified: true });
      } catch {
        // 补拉预置数据失败不影响登录后的正常使用
      }
    },
    [toast, queryClient]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      checked,
      verified: Boolean(user),
      user,
      isAdmin: user?.role === 'admin',
      setupRequired,
      singleUser,
      version,
      openLogin,
      logout,
    }),
    [checked, user, setupRequired, singleUser, version, openLogin, logout]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {modalOpen && (
        <LoginModal
          setupRequired={setupRequired}
          singleUser={singleUser}
          onSuccess={handleLoginSuccess}
          onClose={() => setModalOpen(false)}
        />
      )}
    </AuthContext.Provider>
  );
}

type Mode = 'login' | 'register';

function LoginModal({
  setupRequired,
  singleUser,
  onSuccess,
  onClose,
}: {
  setupRequired: boolean;
  singleUser: boolean;
  onSuccess: (user: PublicUser) => void | Promise<void>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState(singleUser ? 'admin' : '');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const userRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);

  // 只有一个账号（从单密码版升级上来的老部署）：直接聚焦密码框，
  // 老用户不需要理解「用户名」这回事就能登进去。
  useEffect(() => {
    if (singleUser) passRef.current?.focus();
    else userRef.current?.focus();
  }, [singleUser, mode]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const submit = async () => {
    if (loading) return;
    setError('');

    if (mode === 'login') {
      if (!password) return;
      setLoading(true);
      try {
        const res = await api.login(singleUser ? 'admin' : username.trim(), password);
        await onSuccess(res.user);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '登录失败';
        setError(msg === '需要登录' ? '用户名或密码错误' : msg);
        setPassword('');
        passRef.current?.focus();
      } finally {
        setLoading(false);
      }
      return;
    }

    // 注册
    if (!inviteCode.trim()) return setError('请填写邀请码');
    if (!username.trim()) return setError('请填写用户名');
    if (password.length < 6) return setError('密码至少 6 位');
    if (password !== confirm) return setError('两次输入的密码不一致');

    setLoading(true);
    try {
      const res = await api.register(inviteCode.trim(), username.trim(), password);
      await onSuccess(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败');
    } finally {
      setLoading(false);
    }
  };

  const canSubmit =
    mode === 'login'
      ? Boolean(password) && (singleUser || Boolean(username.trim()))
      : Boolean(inviteCode.trim() && username.trim() && password && confirm);

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/80 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-sm mx-4 rounded-xl bg-surface-raised p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={setupRequired ? '需要初始化' : mode === 'login' ? '登录' : '邀请码注册'}
      >
        {setupRequired ? (
          <>
            <h2 className="mb-3 text-lg font-semibold text-content">服务端尚未初始化</h2>
            <p className="text-sm leading-relaxed text-muted">
              还没有任何账号。请在部署环境里设置 <code className="text-accent">PASSWORD</code>
              环境变量后重启服务，系统会自动用这个密码创建管理员账号{' '}
              <code className="text-accent">admin</code>，登录后即可在设置里生成邀请码、添加其他用户。
            </p>
            <button type="button" className="btn-ghost mt-5 w-full" onClick={onClose}>
              我知道了
            </button>
          </>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-1 rounded-lg bg-content/[0.06] p-1">
              {(['login', 'register'] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m);
                    setError('');
                  }}
                  className={`flex-1 rounded-md px-3 py-1.5 text-sm transition-colors ${
                    mode === m
                      ? 'bg-surface text-content shadow-sm'
                      : 'text-muted hover:text-content'
                  }`}
                >
                  {m === 'login' ? '登录' : '邀请码注册'}
                </button>
              ))}
            </div>

            <h2 className="mb-1 text-lg font-semibold text-content">
              {mode === 'login' ? `登录 ${SITE_NAME}` : '创建账号'}
            </h2>
            <p className="mb-4 text-sm text-muted">
              {mode === 'login'
                ? singleUser
                  ? '请输入密码继续'
                  : '请输入用户名和密码继续'
                : '需要管理员提供的一次性邀请码'}
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
              className="space-y-3"
            >
              {mode === 'register' && (
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  className="input w-full font-mono tracking-[0.2em] uppercase"
                  placeholder="邀请码"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={24}
                />
              )}

              {(!singleUser || mode === 'register') && (
                <input
                  ref={userRef}
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="input w-full"
                  placeholder="用户名"
                  autoComplete="username"
                  maxLength={24}
                />
              )}

              <input
                ref={passRef}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input w-full"
                placeholder={mode === 'register' ? '设置密码（至少 6 位）' : '密码'}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              />

              {mode === 'register' && (
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="input w-full"
                  placeholder="再输一次密码"
                  autoComplete="new-password"
                />
              )}

              {error && <p className="text-sm text-danger">{error}</p>}

              <button type="submit" className="btn-primary w-full" disabled={loading || !canSubmit}>
                {loading ? '处理中...' : mode === 'login' ? '进入' : '创建并登录'}
              </button>
            </form>

            <p className="mt-4 text-center text-xs text-muted">
              {mode === 'login' ? '没有账号？切到「邀请码注册」，向管理员要一个邀请码。' : '邀请码一次性有效，用过即作废。'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
