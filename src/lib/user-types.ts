/** 用户与邀请码的类型定义（纯类型模块：客户端组件也要用，不能引入 node:fs） */

export type UserRole = 'admin' | 'user';

/** 对外暴露的用户信息（绝不含 passwordHash） */
export interface PublicUser {
  id: string;
  username: string;
  role: UserRole;
  createdAt: number;
  lastLoginAt?: number;
}

/** 邀请码：一次性，用后写入 usedBy/usedAt */
export interface InviteRecord {
  code: string;
  createdBy: string;
  createdByUsername?: string;
  createdAt: number;
  note?: string;
  usedAt?: number;
  usedBy?: string;
  usedByUsername?: string;
}

/** 全局共享配置：源与订阅由管理员维护，所有用户共用（含游客） */
export interface SharedConfig {
  customAPIs: unknown[];
  subscriptions: unknown[];
  liveSubscriptions: unknown[];
  updatedAt: number;
  updatedBy?: string;
}

export interface UserDataPayload {
  /** 个人数据包：收藏、观看历史、搜索历史、偏好设置等，结构由前端定义 */
  data: Record<string, unknown>;
  updatedAt: number;
}

export interface AuthUserResponse {
  authenticated: boolean;
  user: PublicUser | null;
  /** 是否还有任何用户——用于首次初始化引导 */
  userCount: number;
  /** 是否仍兼容「只输密码」的旧客户端 */
  legacyPasswordMode: boolean;
}
