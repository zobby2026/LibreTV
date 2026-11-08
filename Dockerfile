# ---- 构建阶段 ----
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY . .
ENV DOCKER_BUILD=1
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- 运行阶段 ----
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

# 非 root 用户
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# 账号、邀请码、个人数据与会话密钥都写在 data/ 下：必须可写、且要挂卷持久化，
# 否则重建容器等于把所有账号清空。这里先建好并交给运行用户。
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data

USER nextjs

VOLUME ["/app/data"]

EXPOSE 8080
CMD ["node", "server.js"]
