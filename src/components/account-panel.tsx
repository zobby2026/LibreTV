'use client';

import { useCallback, useEffect, useState } from 'react';
import { Drawer } from './drawer';
import { ConfirmDialog } from './confirm-dialog';
import { Icon } from './icon';
import { useAuth } from './auth';
import { useToast } from './toast';
import { api } from '@/lib/client-api';
import { copyToClipboard } from '@/lib/clipboard';
import { formatRelativeTime } from '@/lib/utils';
import type { InviteRecord, PublicUser } from '@/lib/user-types';

/**
 * 账号面板：看自己是谁、改自己的密码；管理员还在这里管邀请码与用户。
 *
 * 为什么单独一个抽屉而不是并进「源管理」：源管理已经是上千行的大组件，
 * 而账号相关的操作频次低、权限边界清晰（管理员才有邀请码/用户列表），
 * 分开后普通用户打开的是一块很轻的面板。
 */
export function AccountPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, isAdmin, logout, openLogin } = useAuth();
  const { toast } = useToast();

  const [invites, setInvites] = useState<InviteRecord[]>([]);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [selfId, setSelfId] = useState('');
  const [note, setNote] = useState('');
  const [creating, setCreating] = useState(false);
  const [freshCode, setFreshCode] = useState('');

  const reload = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const [inv, usr] = await Promise.all([api.listInvites(), api.listUsers()]);
      setInvites(inv.invites);
      setUsers(usr.users);
      setSelfId(usr.selfId);
    } catch (err) {
      toast(err instanceof Error ? err.message : '加载失败', 'error');
    }
  }, [isAdmin, toast]);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  const createInvite = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const { invite } = await api.createInvite(note.trim() || undefined);
      setFreshCode(invite.code);
      setNote('');
      await reload();
      toast('邀请码已生成', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : '生成失败', 'error');
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (code: string) => {
    try {
      await api.revokeInvite(code);
      if (freshCode === code) setFreshCode('');
      await reload();
      toast('已撤销', 'info');
    } catch (err) {
      toast(err instanceof Error ? err.message : '撤销失败', 'error');
    }
  };

  return (
    <Drawer open={open} onClose={onClose} title="账号与权限" width="max-w-lg">
      {!user ? (
        <div className="py-10 text-center">
          <p className="text-sm text-muted">当前未登录。</p>
          <button
            type="button"
            className="btn-primary mt-4"
            onClick={() => {
              onClose();
              openLogin();
            }}
          >
            去登录
          </button>
        </div>
      ) : (
        <div className="space-y-6 pb-6">
          <AccountCard
            user={user}
            onLogout={async () => {
              onClose();
              await logout();
            }}
          />

          <PasswordSection />

          {isAdmin && (
            <InviteSection
              invites={invites}
              note={note}
              onNoteChange={setNote}
              creating={creating}
              onCreate={createInvite}
              onRevoke={revoke}
              freshCode={freshCode}
            />
          )}

          {isAdmin && (
            <UsersSection users={users} selfId={selfId} onChanged={reload} />
          )}

          {isAdmin && (
            <p className="text-xs leading-relaxed text-faint">
              采集站、订阅与直播源是全员共享的，由管理员在「设置 → 源管理」里统一维护；
              收藏、观看历史、过滤开关这些则是每个账号各自独立的，登录后自动同步。
            </p>
          )}
        </div>
      )}
    </Drawer>
  );
}

function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-2 flex items-baseline gap-2">
      <h3 className="text-sm font-semibold text-content">{children}</h3>
      {hint && <span className="text-xs text-faint">{hint}</span>}
    </div>
  );
}

function AccountCard({ user, onLogout }: { user: PublicUser; onLogout: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-card p-3">
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent/15 text-base font-semibold text-accent">
        {user.username.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-content">{user.username}</span>
          <span
            className={`chip ${
              user.role === 'admin'
                ? 'bg-accent/15 text-accent'
                : 'bg-content/[0.07] text-muted'
            }`}
          >
            {user.role === 'admin' ? '管理员' : '普通用户'}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-faint">
          {user.lastLoginAt ? `上次登录 ${formatRelativeTime(user.lastLoginAt)}` : '首次登录'}
        </p>
      </div>
      <button type="button" className="btn-ghost btn-sm shrink-0" onClick={onLogout}>
        退出
      </button>
    </div>
  );
}

function PasswordSection() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [oldPassword, setOld] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError('');
    if (newPassword.length < 6) return setError('新密码至少 6 位');
    if (newPassword !== confirm) return setError('两次输入的新密码不一致');
    setLoading(true);
    try {
      await api.changePassword(oldPassword, newPassword);
      toast('密码已更新', 'success');
      setOpen(false);
      setOld('');
      setNew('');
      setConfirm('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '修改失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section>
      <SectionTitle hint="会话 90 天有效">登录密码</SectionTitle>
      {!open ? (
        <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(true)}>
          修改密码
        </button>
      ) : (
        <form
          className="space-y-2 rounded-lg border border-line bg-card p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <input
            type="password"
            className="input w-full"
            placeholder="当前密码"
            autoComplete="current-password"
            value={oldPassword}
            onChange={(e) => setOld(e.target.value)}
          />
          <input
            type="password"
            className="input w-full"
            placeholder="新密码（至少 6 位）"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNew(e.target.value)}
          />
          <input
            type="password"
            className="input w-full"
            placeholder="再输一次新密码"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="submit" className="btn-primary btn-sm" disabled={loading}>
              {loading ? '保存中...' : '保存'}
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => {
                setOpen(false);
                setError('');
              }}
            >
              取消
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function InviteSection({
  invites,
  note,
  onNoteChange,
  creating,
  onCreate,
  onRevoke,
  freshCode,
}: {
  invites: InviteRecord[];
  note: string;
  onNoteChange: (v: string) => void;
  creating: boolean;
  onCreate: () => void;
  onRevoke: (code: string) => void;
  freshCode: string;
}) {
  const { toast } = useToast();
  const unused = invites.filter((i) => !i.usedAt);

  const copy = async (code: string) => {
    const ok = await copyToClipboard(code);
    toast(ok ? '邀请码已复制' : '复制失败，请手动选中', ok ? 'success' : 'error');
  };

  return (
    <section>
      <SectionTitle hint={`${unused.length} 个未使用`}>邀请码</SectionTitle>
      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder="备注（可选，例如给谁）"
          value={note}
          maxLength={40}
          onChange={(e) => onNoteChange(e.target.value)}
        />
        <button type="button" className="btn-primary shrink-0" onClick={onCreate} disabled={creating}>
          {creating ? '生成中...' : '生成'}
        </button>
      </div>

      {freshCode && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 p-2.5">
          <span className="font-mono text-base tracking-[0.2em] text-accent">{freshCode}</span>
          <button type="button" className="btn-ghost btn-sm ml-auto" onClick={() => copy(freshCode)}>
            复制
          </button>
        </div>
      )}

      <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-card">
        {invites.length === 0 && (
          <li className="px-3 py-4 text-center text-xs text-faint">还没有邀请码</li>
        )}
        {invites.map((inv) => (
          <li key={inv.code} className="flex items-center gap-2 px-3 py-2">
            <span
              className={`font-mono text-sm tracking-wider ${
                inv.usedAt ? 'text-faint line-through' : 'text-content'
              }`}
            >
              {inv.code}
            </span>
            <div className="min-w-0 flex-1 text-xs text-faint">
              {inv.usedAt ? (
                <span>已由 {inv.usedByUsername || '未知用户'} 使用 · {formatRelativeTime(inv.usedAt)}</span>
              ) : (
                <span>{inv.note || '未使用'} · {formatRelativeTime(inv.createdAt)}</span>
              )}
            </div>
            {!inv.usedAt && (
              <>
                <button
                  type="button"
                  className="btn-ghost btn-sm shrink-0"
                  onClick={() => copy(inv.code)}
                  aria-label={`复制邀请码 ${inv.code}`}
                >
                  复制
                </button>
                <button
                  type="button"
                  className="btn-ghost btn-sm shrink-0"
                  onClick={() => onRevoke(inv.code)}
                  aria-label={`撤销邀请码 ${inv.code}`}
                >
                  撤销
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function UsersSection({
  users,
  selfId,
  onChanged,
}: {
  users: PublicUser[];
  selfId: string;
  onChanged: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [pendingDelete, setPendingDelete] = useState<PublicUser | null>(null);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetValue, setResetValue] = useState('');

  const setRole = async (u: PublicUser, role: 'admin' | 'user') => {
    try {
      await api.patchUser({ id: u.id, role });
      await onChanged();
      toast(role === 'admin' ? `已把 ${u.username} 设为管理员` : `已取消 ${u.username} 的管理员`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : '操作失败', 'error');
    }
  };

  const resetPassword = async (u: PublicUser) => {
    if (resetValue.length < 6) {
      toast('新密码至少 6 位', 'error');
      return;
    }
    try {
      await api.patchUser({ id: u.id, newPassword: resetValue });
      setResetFor(null);
      setResetValue('');
      toast(`已重置 ${u.username} 的密码`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : '重置失败', 'error');
    }
  };

  const remove = async (u: PublicUser) => {
    try {
      await api.deleteUser(u.id);
      await onChanged();
      toast(`已删除 ${u.username}`, 'info');
    } catch (err) {
      toast(err instanceof Error ? err.message : '删除失败', 'error');
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <section>
      <SectionTitle hint={`${users.length} 个账号`}>用户</SectionTitle>
      <ul className="divide-y divide-line rounded-lg border border-line bg-card">
        {users.map((u) => (
          <li key={u.id} className="px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm text-content">{u.username}</span>
              {u.id === selfId && <span className="chip bg-content/[0.07] text-faint">我</span>}
              {u.role === 'admin' && <span className="chip bg-accent/15 text-accent">管理员</span>}
              <span className="ml-auto shrink-0 text-xs text-faint">
                {u.lastLoginAt ? formatRelativeTime(u.lastLoginAt) : '未登录过'}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {u.role === 'user' ? (
                <button type="button" className="btn-ghost btn-sm" onClick={() => setRole(u, 'admin')}>
                  设为管理员
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => setRole(u, 'user')}
                  disabled={u.id === selfId}
                >
                  取消管理员
                </button>
              )}
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => {
                  setResetFor(resetFor === u.id ? null : u.id);
                  setResetValue('');
                }}
              >
                重置密码
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => setPendingDelete(u)}
                disabled={u.id === selfId}
              >
                删除
              </button>
            </div>
            {resetFor === u.id && (
              <div className="mt-1.5 flex gap-1.5">
                <input
                  type="text"
                  className="input flex-1"
                  placeholder="新密码（至少 6 位，直接告诉对方）"
                  value={resetValue}
                  onChange={(e) => setResetValue(e.target.value)}
                />
                <button type="button" className="btn-primary btn-sm" onClick={() => resetPassword(u)}>
                  确定
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="删除账号"
        danger
        confirmLabel="删除"
        message={
          pendingDelete ? (
            <>
              将删除账号 <span className="text-content">{pendingDelete.username}</span> 及其在服务端的个人数据
              （收藏、观看历史、偏好）。该操作不可撤销。
            </>
          ) : null
        }
        onConfirm={() => pendingDelete && remove(pendingDelete)}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
}
