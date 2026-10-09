# ViTransfer - Multi-Architecture Docker Image
# Supports: amd64, arm64 | Security: non-root user via PUID/PGID

FROM node:24-alpine3.23 AS base

ARG TARGETPLATFORM
ARG TARGETARCH
ARG BUILDPLATFORM

# Images are built on GitHub-hosted runners, so use the upstream registries.
RUN apk update && apk upgrade --no-cache && \
    apk add --no-cache \
        openssl openssl-dev \
        ffmpeg ffmpeg-libs fontconfig ttf-dejavu font-noto-cjk \
        bash curl ca-certificates shadow su-exec \
    && apk add --no-cache --upgrade cjson libsndfile giflib orc zlib expat \
    && npm config set registry https://registry.npmjs.org \
    && npm install -g npm@latest \
    && npm cache clean --force \
    && ffmpeg -version

# === Dependencies ===
FROM base AS deps
WORKDIR /app

COPY --link package.json package-lock.json* ./
COPY --link prisma ./prisma

RUN --mount=type=cache,target=/root/.npm \
    npm config set registry https://registry.npmjs.org \
    && npm ci --legacy-peer-deps

RUN cp -R node_modules /tmp/prod_node_modules

ARG SKIP_NPM_AUDIT=false

RUN if [ "$SKIP_NPM_AUDIT" = "true" ]; then \
      echo "Skipping in-image npm audit; external audit remains required."; \
    else \
      npm audit --audit-level=high --registry=https://registry.npmjs.org || \
      (echo "SECURITY: High/critical vulnerabilities found!" && exit 1); \
    fi

# === Builder ===
FROM base AS builder
WORKDIR /app

COPY --from=deps --link /app/node_modules ./node_modules
COPY --link . .

RUN npx prisma generate

ARG APP_VERSION
ENV NEXT_PUBLIC_APP_VERSION=${APP_VERSION}
# 静态资源换出口（`/_next/static/**`）。留空＝维持同源直出，与今天完全一样。
# 这一枚只管 build：next.config 把它写进 assetPrefix，同时内联一份常量
# `BUILD_ASSET_PREFIX` 给 CSP 用。runner 还要单独再配一遍（见下面），因为
# `next start` 会在运行期重新求值 next.config.js。
ARG ASSET_PREFIX=
ENV ASSET_PREFIX=${ASSET_PREFIX}
ENV SKIP_ENV_VALIDATION=1
ENV NEXT_PHASE=phase-production-build
RUN npm run build && rm -rf .next/cache

# === Production ===
FROM base AS runner
WORKDIR /app

# ARG 不跨 stage，而且 `next start` 在运行期会重新求值 next.config.js：runner 里少了这一枚，
# 构建期内联过前缀的那批路由 chunk 走 CDN、SSR 现场画的 CSS／webpack runtime／polyfills 却
# 留在源站，半套前缀不报错、只是把一半流量白留在应用容器上（判据 C6 钉着这两行）。
ARG ASSET_PREFIX=
ENV ASSET_PREFIX=${ASSET_PREFIX}

ARG APP_VERSION
LABEL org.opencontainers.image.title="ViTransfer"
LABEL org.opencontainers.image.description="Video review and approval platform"
LABEL org.opencontainers.image.source="https://github.com/xiaoxiaobai622-boop/xiaobaic-review"
LABEL org.opencontainers.image.version="${APP_VERSION}"
LABEL org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production


# Python for Apprise notifications
RUN apk add --no-cache python3 py3-pip \
    && python3 -m venv /opt/apprise-venv \
    && /opt/apprise-venv/bin/pip install --no-cache-dir --timeout=120 --upgrade pip \
    && /opt/apprise-venv/bin/pip install --no-cache-dir --timeout=120 apprise==1.11.0 \
    && apk del --no-cache py3-pip

ENV APPRISE_PYTHON=/opt/apprise-venv/bin/python3

ARG TARGETPLATFORM
ARG TARGETARCH
RUN echo "Building for: $TARGETPLATFORM ($TARGETARCH)" && uname -a

# App user (UID 911, remappable via PUID/PGID)
RUN addgroup -g 911 app && adduser -D -u 911 -G app -h /app app

# Copy production files
COPY --from=deps --link /tmp/prod_node_modules ./node_modules
COPY --from=builder --link /app/public ./public
COPY --from=builder --link /app/.next ./.next
COPY --from=builder --link /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --link /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --link /app/prisma ./prisma
COPY --from=builder --link /app/src ./src
# 内容页文稿在运行时按路径读（`src/lib/marketing/content.ts:11` = `process.cwd()/content/marketing`），
# 不在 `.next` 产物里；runner 是逐目录显式 COPY 的，少这一行就等于生产没有内容页。
COPY --from=builder --link /app/content ./content
COPY --from=builder --link /app/package.json ./package.json
COPY --from=builder --link /app/tsconfig.json ./tsconfig.json
COPY --from=builder --link /app/next.config.js ./next.config.js
COPY --from=builder --link /app/worker.mjs ./worker.mjs
COPY --link --chmod=0755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY --link previewlut.cube /usr/share/ffmpeg/previewlut.cube

# Windows checkouts may convert the shell script to CRLF. Normalize it for Linux.
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh && \
    chmod a+r /usr/share/ffmpeg/previewlut.cube && \
    chown app:app /app

ENV PUID=1000 PGID=1000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:4321/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})" || exit 1

EXPOSE 4321
ENV PORT=4321 HOSTNAME="0.0.0.0"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["npm", "start"]
