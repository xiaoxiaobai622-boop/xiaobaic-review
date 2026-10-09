const createNextIntlPlugin = require('next-intl/plugin')
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

/**
 * 静态资源（`/_next/static/**`，文件名自带内容 hash）换出口的唯一定义处。
 * 空＝完全维持现状（同源直出）。构建期由 Dockerfile 的 ARG 注入，
 * 同一个值再以 `env.BUILD_ASSET_PREFIX` 内联进产物，让 `src/proxy.ts` 的 CSP 读到
 * 同一份——runner 容器里没有运行期 `ASSET_PREFIX`，两边不同源就是全站脚本被自己拦死。
 */
const ASSET_PREFIX = (process.env.ASSET_PREFIX || '').trim().replace(/\/+$/, '')

/** @type {import('next').NextConfig} */
const nextConfig = {
  assetPrefix: ASSET_PREFIX || undefined,
  env: { BUILD_ASSET_PREFIX: ASSET_PREFIX },
  poweredByHeader: false,
  // Keep Node-only dependencies out of the client/instrumentation bundle.
  // This is required when running with Webpack on environments without the
  // native Turbopack SWC bindings.
  serverExternalPackages: ['ioredis'],
  // 营销页那四张界面截图里全是小字，默认只放行 q=75，WebP 在暗底小字上会糊成一团。
  images: {
    qualities: [75, 90],
  },
  // Increase body size limit for TUS chunked uploads
  // TUS uploads can send chunks larger than 10MB (default Next.js limit)
  // Set to 100MB to handle large video chunks safely
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb'
    }
  },

  // Security headers are set in src/proxy.ts (nonce-based CSP)
  // Static asset headers below cover paths that bypass proxy
  async headers() {
    return [
      {
        source: '/:path(brand|favicon|manifest\\.json|robots\\.txt|sw\\.js)/:rest*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ]
  }
}

module.exports = withNextIntl(nextConfig)
