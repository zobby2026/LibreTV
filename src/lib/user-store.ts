import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { hashPassword, verifyPassword } from './passwords';
import type { InviteRecord, PublicUser, SharedConfig, UserDataPayload, UserRole } from './user-types';

/**
 * 用户数据存储（文件实现）。
 *
 * 为什么是文件而不是 SQLite：本站是单实例自托管，用户量在几十人量级，
 * 一次消息推送就是读写一个几十 KB 的 JSON；换成 better-sqlite3 要多一个原生模块
 * 编译依赖，反而让 Docker 构建更脆。所以：
 * - 每个用户的数据单独一个文件（避免多人同时写同一文件）
 * - 所有写操作串行化（单进程内队列）+ 先写临时文件再 rename（原子替换）
 * - 内存里不做长期缓存，读多了磁盘也就几毫秒；避免 dev 热重载后缓存不一致
 *
 * 换成外部数据库时，只需替换本文件的导出函数，API 层不用动。
 */

interface UserRecord {
  id: string;
  username: string;
  usernameLower: string;
  passwordHash: string;
  role: UserRole;
  createdAt: number;
  lastLoginAt?: number;
  /** 通过哪个邀请码注册 */
  createdVia?: string;
}

interface UsersFile {
  users: UserRecord[];
}
interface InvitesFile {
  invites: InviteRecord[];
}

/** 写队列挂在 globalThis：Next dev 热重载会重新执行模块，全局单例才不会双写 */
type Queue = Promise<unknown>;
interface StoreGlobal {
  __ltvUserQueue?: Queue;
  __ltvInit?: Promise<void>;
}
const g = globalThis as unknown as StoreGlobal;

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const prev = g.__ltvUserQueue ?? Promise.resolve();
  const next = prev.then(fn, fn);
  g.__ltvUserQueue = next.catch(() => undefined);
  return next;
}

function dataDir(): string {
  return process.env.LIBRETV_DATA_DIR || path.join(process.cwd(), 'data');
}
const usersPath = () => path.join(dataDir(), 'users.json');
const invitesPath = () => path.join(dataDir(), 'invites.json');
const sharedPath = () => path.join(dataDir(), 'shared.json');
const userDataPath = (userId: string) => path.join(dataDir(), 'user-data', `${userId}.json`);

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

// —— 用户名 / 密码 / 邀请码规则 ——

export const USERNAME_MIN = 2;
export const USERNAME_MAX = 24;
export const PASSWORD_MIN = 6;

export function validateUsername(username: string): string | null {
  const name = username.trim();
  if (name.length < USERNAME_MIN) return `用户名至少 ${USERNAME_MIN} 个字符`;
  if (name.length > USERNAME_MAX) return `用户名最多 ${USERNAME_MAX} 个字符`;
  if (!/^[\p{L}\p{N}_.-]+$/u.test(name)) return '用户名只能包含中文、字母、数字、下划线、点或短横线';
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `密码至少 ${PASSWORD_MIN} 位`;
  if (password.length > 128) return '密码太长';
  return null;
}

/** 邀请码字符集去掉 0/O/1/I/L 这些手抄容易混的字符 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode(len = 8): string {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

function toPublic(u: UserRecord): PublicUser {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
  };
}

function makeUser(
  username: string,
  password: string,
  role: UserRole,
  createdVia?: string
): UserRecord {
  return {
    id: crypto.randomUUID(),
    username: username.trim(),
    usernameLower: username.trim().toLowerCase(),
    passwordHash: hashPassword(password),
    role,
    createdAt: Date.now(),
    createdVia,
  };
}

/**
 * 首次初始化：只负责把数据目录建好。
 *
 * 这里**不再**用 PASSWORD 自动创建 admin —— 账号统一由网页上的初始化弹窗创建
 * （POST /api/setup），部署者不用为了建个号去改环境变量、重启容器。
 * PASSWORD 的用途收敛成一道可选的闸门：配了它，初始化时必须先填对，
 * 避免站点刚上线就被公网上的陌生人抢注成管理员（见 /api/setup）。
 */
async function initOnce(): Promise<void> {
  await fs.mkdir(path.join(dataDir(), 'user-data'), { recursive: true });
}

export function ensureStore(): Promise<void> {
  if (!g.__ltvInit) {
    g.__ltvInit = serialize(initOnce).catch((err) => {
      // 初始化失败允许下次重试
      g.__ltvInit = undefined;
      throw err;
    });
  }
  return g.__ltvInit;
}

async function readUsers(): Promise<UserRecord[]> {
  await ensureStore();
  const file = await readJson<UsersFile>(usersPath(), { users: [] });
  return file.users;
}

async function writeUsers(users: UserRecord[]): Promise<void> {
  await writeJson(usersPath(), { users });
}

// —— 查询 ——

export async function countUsers(): Promise<number> {
  return (await readUsers()).length;
}

export async function listUsers(): Promise<PublicUser[]> {
  const users = await readUsers();
  return users
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(toPublic);
}

export async function findUserById(id: string): Promise<PublicUser | null> {
  const user = (await readUsers()).find((u) => u.id === id);
  return user ? toPublic(user) : null;
}

/**
 * 只有一个账号时返回它的用户名，否则 null。
 *
 * 用来兼容「老用户只记得密码」的登录习惯：单账号站点上不必输入用户名。
 * 但不能硬编码成 admin —— 管理员可能叫 zobby、老公、whatever，
 * 硬编码会让唯一那条登录路径直接走不通。
 */
export async function getSoleUsername(): Promise<string | null> {
  const users = await readUsers();
  return users.length === 1 ? users[0].username : null;
}

// —— 登录 ——

export async function authenticate(
  username: string,
  password: string
): Promise<PublicUser | null> {
  const name = username.trim().toLowerCase();
  return serialize(async () => {
    const users = await readUsers();
    const idx = users.findIndex((u) => u.usernameLower === name);
    if (idx === -1) return null;
    if (!verifyPassword(password, users[idx].passwordHash)) return null;
    users[idx].lastLoginAt = Date.now();
    await writeUsers(users);
    return toPublic(users[idx]);
  });
}

// —— 注册（一次性邀请码） ——

export interface RegisterResult {
  ok: boolean;
  error?: string;
  user?: PublicUser;
}

/**
 * 网页初始化：创建本站第一个管理员账号。
 *
 * 只在「一个用户都没有」时生效——放进写队列里判断，避免两个人同时提交
 * 都能通过 `users.length === 0` 的检查，最后建出两个管理员。
 */
export async function createFirstAdmin(input: {
  username: string;
  password: string;
}): Promise<RegisterResult> {
  const nameErr = validateUsername(input.username);
  if (nameErr) return { ok: false, error: nameErr };
  const pwErr = validatePassword(input.password);
  if (pwErr) return { ok: false, error: pwErr };

  return serialize(async () => {
    const users = await readUsers();
    if (users.length > 0) return { ok: false, error: '站点已完成初始化，请直接登录' };
    const admin = makeUser(input.username, input.password, 'admin');
    users.push(admin);
    await writeUsers(users);
    return { ok: true, user: toPublic(admin) };
  });
}

export async function registerWithInvite(input: {
  code: string;
  username: string;
  password: string;
}): Promise<RegisterResult> {
  const nameErr = validateUsername(input.username);
  if (nameErr) return { ok: false, error: nameErr };
  const pwErr = validatePassword(input.password);
  if (pwErr) return { ok: false, error: pwErr };

  const code = input.code.trim().toUpperCase();
  if (!code) return { ok: false, error: '请填写邀请码' };

  return serialize(async () => {
    const invitesFile = await readJson<InvitesFile>(invitesPath(), { invites: [] });
    const invite = invitesFile.invites.find((i) => i.code === code);
    if (!invite) return { ok: false, error: '邀请码无效' };
    if (invite.usedAt) return { ok: false, error: '邀请码已被使用' };

    const users = await readUsers();
    const lower = input.username.trim().toLowerCase();
    if (users.some((u) => u.usernameLower === lower)) {
      return { ok: false, error: '该用户名已被占用' };
    }

    const user = makeUser(input.username, input.password, 'user', code);
    // 先占住邀请码，再落用户；任一步失败都回滚，避免「码被吃掉但没注册成功」
    invite.usedAt = Date.now();
    invite.usedBy = user.id;
    invite.usedByUsername = user.username;
    await writeJson(invitesPath(), invitesFile);
    try {
      users.push(user);
      await writeUsers(users);
    } catch (err) {
      invite.usedAt = undefined;
      invite.usedBy = undefined;
      invite.usedByUsername = undefined;
      await writeJson(invitesPath(), invitesFile).catch(() => {});
      throw err;
    }
    return { ok: true, user: toPublic(user) };
  });
}

// —— 邀请码管理 ——

export async function generateInvite(createdBy: string, note?: string): Promise<InviteRecord> {
  return serialize(async () => {
    const users = await readUsers();
    const creator = users.find((u) => u.id === createdBy);
    const invitesFile = await readJson<InvitesFile>(invitesPath(), { invites: [] });
    let code = randomCode();
    while (invitesFile.invites.some((i) => i.code === code)) code = randomCode();
    const record: InviteRecord = {
      code,
      createdBy,
      createdByUsername: creator?.username,
      createdAt: Date.now(),
      note: note?.trim() || undefined,
    };
    invitesFile.invites.push(record);
    await writeJson(invitesPath(), invitesFile);
    return record;
  });
}

export async function listInvites(): Promise<InviteRecord[]> {
  await ensureStore();
  const file = await readJson<InvitesFile>(invitesPath(), { invites: [] });
  return file.invites.slice().sort((a, b) => b.createdAt - a.createdAt);
}

export async function revokeInvite(code: string): Promise<boolean> {
  return serialize(async () => {
    const file = await readJson<InvitesFile>(invitesPath(), { invites: [] });
    const idx = file.invites.findIndex((i) => i.code === code);
    if (idx === -1 || file.invites[idx].usedAt) return false;
    file.invites.splice(idx, 1);
    await writeJson(invitesPath(), file);
    return true;
  });
}

// —— 个人数据 ——

export async function getUserData(userId: string): Promise<UserDataPayload> {
  await ensureStore();
  return readJson<UserDataPayload>(userDataPath(userId), { data: {}, updatedAt: 0 });
}

export async function saveUserData(
  userId: string,
  data: Record<string, unknown>
): Promise<UserDataPayload> {
  const payload: UserDataPayload = { data, updatedAt: Date.now() };
  await writeJson(userDataPath(userId), payload);
  return payload;
}

// —— 全局共享配置（源与订阅） ——

export async function getSharedConfig(): Promise<SharedConfig> {
  await ensureStore();
  return readJson<SharedConfig>(sharedPath(), {
    customAPIs: [],
    subscriptions: [],
    liveSubscriptions: [],
    updatedAt: 0,
  });
}

export async function saveSharedConfig(
  patch: Partial<Pick<SharedConfig, 'customAPIs' | 'subscriptions' | 'liveSubscriptions'>>,
  updatedBy: string
): Promise<SharedConfig> {
  return serialize(async () => {
    const current = await readJson<SharedConfig>(sharedPath(), {
      customAPIs: [],
      subscriptions: [],
      liveSubscriptions: [],
      updatedAt: 0,
    });
    const next: SharedConfig = {
      customAPIs: patch.customAPIs ?? current.customAPIs,
      subscriptions: patch.subscriptions ?? current.subscriptions,
      liveSubscriptions: patch.liveSubscriptions ?? current.liveSubscriptions,
      updatedAt: Date.now(),
      updatedBy,
    };
    await writeJson(sharedPath(), next);
    return next;
  });
}

// —— 用户管理（管理员） ——

export async function setUserRole(userId: string, role: UserRole): Promise<boolean> {
  return serialize(async () => {
    const users = await readUsers();
    const user = users.find((u) => u.id === userId);
    if (!user) return false;
    user.role = role;
    await writeUsers(users);
    return true;
  });
}

export async function changePassword(userId: string, newPassword: string): Promise<string | null> {
  const err = validatePassword(newPassword);
  if (err) return err;
  return serialize(async () => {
    const users = await readUsers();
    const user = users.find((u) => u.id === userId);
    if (!user) return '用户不存在';
    user.passwordHash = hashPassword(newPassword);
    await writeUsers(users);
    return null;
  });
}

export async function deleteUser(userId: string): Promise<boolean> {
  return serialize(async () => {
    const users = await readUsers();
    const idx = users.findIndex((u) => u.id === userId);
    if (idx === -1) return false;
    // 不允许删掉最后一个管理员，避免把自己锁在门外
    const admins = users.filter((u) => u.role === 'admin');
    if (users[idx].role === 'admin' && admins.length <= 1) return false;
    users.splice(idx, 1);
    await writeUsers(users);
    await fs.unlink(userDataPath(userId)).catch(() => {});
    return true;
  });
}
