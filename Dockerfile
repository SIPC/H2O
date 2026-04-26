# syntax=docker/dockerfile:1.7

# ---------- deps：只装依赖，利用缓存层 ----------
FROM node:24-alpine AS deps
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---------- builder：构建 standalone 产物 ----------
FROM node:24-alpine AS builder
WORKDIR /app

RUN corepack enable

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN pnpm build

# ---------- runner：最终运行镜像 ----------
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# data 目录固定到容器内 /app/data，通过 volume 挂出
ENV H2O_DB_PATH=/app/data/h2o.sqlite
ENV H2O_LOGS_DB_PATH=/app/data/h2o-logs.sqlite

# tini 负责正确转发信号和回收僵尸进程
RUN apk add --no-cache tini tzdata \
 && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
 && echo "Asia/Shanghai" > /etc/timezone \
 && addgroup -S -g 1001 nodejs \
 && adduser -S -u 1001 -G nodejs nextjs


# standalone 输出已经自带最小化的 node_modules 与 server.js
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data

USER nextjs

EXPOSE 3000
VOLUME ["/app/data"]

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
