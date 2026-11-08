import { NextResponse } from 'next/server';
import { isPasswordConfigured, sessionUserId } from '@/lib/auth';
import { countUsers, findUserById, getSoleUsername } from '@/lib/user-store';
import { getEnvSources } from '@/lib/env-sources';
import { getEnvLiveSources } from '@/lib/env-live-sources';
import { getEnvSubscriptions } from '@/lib/env-subscriptions';
import { getEnvRecommendSource } from '@/lib/env-recommend-source';
import { getEnvImageMode } from '@/lib/env-image-mode';
import type { AuthStatusResponse } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * 站点状态：客户端据此决定是否弹出登录框、页头显示哪个账号，
 * 并获取部署者预置的采集站 / 直播源。
 *
 * 这个接口必须永远 200：它是首屏渲染的第一跳，失败会让整站白屏。
 * 用户存储读不出来时退化为「未登录 + 需要初始化」，把具体错误留给登录接口报。
 */
export async function GET(req: Request) {
  const userId = sessionUserId(req.headers.get('cookie'));

  let userCount = 0;
  try {
    userCount = await countUsers();
  } catch (err) {
    console.error('[zobby] 读取用户存储失败', err);
  }
  const user = userId ? await findUserById(userId).catch(() => null) : null;
  // 单账号站点：登录框按这个用户名预填，客户端不必猜 admin
  const soleUsername = userCount === 1 ? await getSoleUsername().catch(() => null) : null;

  const payload: AuthStatusResponse & Record<string, unknown> = {
    user,
    verified: Boolean(user),
    setupRequired: userCount === 0,
    // 初始化时是否需要先填部署密钥（即部署者是否设置了 PASSWORD）
    setupRequiresKey: isPasswordConfigured(),
    userCount,
    legacyPasswordMode: soleUsername !== null,
    singleUsername: soleUsername,
    // 构建时由 next.config.ts 从 package.json 注入
    version: process.env.APP_VERSION || 'dev',
    // 部署者通过 DEFAULT_SOURCES 预置的采集站
    defaultSources: getEnvSources(),
    // 部署者通过 DEFAULT_LIVE_SOURCES 预置的直播源（M3U 订阅）
    defaultLiveSources: getEnvLiveSources(),
    // 部署者通过 DEFAULT_SUBSCRIPTIONS 预置的 SourceList 订阅链接
    defaultSubscriptions: getEnvSubscriptions(),
    // 部署者通过 DEFAULT_RECOMMEND_SOURCE 指定的首页推荐数据源默认值（未配置时为 null）
    defaultRecommendSource: getEnvRecommendSource() ?? null,
    // 部署者通过 DEFAULT_IMAGE_MODE 指定的封面图加载方式默认值（未配置时为 null）
    defaultImageMode: getEnvImageMode() ?? null,
  };
  return NextResponse.json(payload);
}
