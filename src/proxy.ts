import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { safeReturnUrl } from '@/lib/return-url'

const DANGEROUS_PROTOCOL = /^(javascript|data|vbscript):/i
const PUBLIC_MEDIA_ORIGIN = 'https://vidx.cn'
// 首页演示视频这类静态媒体直接走对象存储 CDN；域名写死一份，免得本地 .env 没配就播不出来。
const PUBLIC_MEDIA_CDN_ORIGIN = 'https://media.vidx.cn'

export async function proxy(request: NextRequest) {
  const url = request.nextUrl

  // Sanitize returnUrl on the login page
  if (url.pathname === '/login') {
    const returnUrl = url.searchParams.get('returnUrl')
    if (returnUrl && safeReturnUrl(returnUrl, '/studio/projects') !== returnUrl) {
      url.searchParams.set('returnUrl', '/studio/projects')
      return NextResponse.redirect(url)
    }
  }

  // Strip dangerous protocol schemes from query parameters
  let sanitized = false
  for (const [key, value] of url.searchParams.entries()) {
    if (DANGEROUS_PROTOCOL.test(value.trim())) {
      url.searchParams.delete(key)
      sanitized = true
    }
  }
  if (sanitized) {
    return NextResponse.redirect(url)
  }

  // Generate nonce for CSP
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')

  const isHttpsEnabled = process.env.HTTPS_ENABLED === 'true' || process.env.HTTPS_ENABLED === '1'

  // Derive S3 origin for CSP — presigned redirects go directly to the S3 endpoint
  let s3Origin = ''
  let s3BucketOrigin = ''
  let mediaCdnOrigin = ''
  if (process.env.STORAGE_PROVIDER === 's3' && process.env.S3_ENDPOINT) {
    try {
      const endpoint = new URL(process.env.S3_ENDPOINT)
      s3Origin = endpoint.origin
      if (process.env.S3_FORCE_PATH_STYLE === 'false' && process.env.S3_BUCKET) {
        s3BucketOrigin = `${endpoint.protocol}//${process.env.S3_BUCKET}.${endpoint.host}`
      }
    } catch {}
  }

  if (process.env.MEDIA_CDN_BASE_URL) {
    try {
      mediaCdnOrigin = new URL(process.env.MEDIA_CDN_BASE_URL).origin
    } catch {}
  }

  // `/_next/static/**` 被 assetPrefix 挪去 CDN 时，脚本/样式/字体三条指令必须一起放行。
  // 读构建期内联的那枚（next.config 的 `env.BUILD_ASSET_PREFIX`）而不是运行期 env：
  // runner 容器没配 `ASSET_PREFIX`，读运行期会得到空串，于是线上静默白屏、本地却看不出来。
  let assetOrigin = ''
  try {
    const prefix = (process.env.BUILD_ASSET_PREFIX || '').trim()
    if (prefix) assetOrigin = ` ${new URL(prefix).origin}`
  } catch {}

  const connectSrc = [
    "'self'",
    'blob:',
    // hls.js fetches CDN-backed playlist segments through XHR/fetch, which
    // is governed by connect-src rather than media-src.
    mediaCdnOrigin,
    s3Origin,
    s3BucketOrigin,
  ].filter(Boolean).join(' ')

  // Next/Turbopack's React development diagnostics use eval() for source
  // mapped call stacks. Keep this allowance development-only; production
  // remains nonce-based without unsafe-eval.
  const developmentScriptSource = process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''

  // Env-derived origins are appended to both media-facing directives, in the
  // same order, so the two lists can never drift apart.
  const extraMediaOrigins = [PUBLIC_MEDIA_CDN_ORIGIN, mediaCdnOrigin, s3Origin, s3BucketOrigin]
    .filter(Boolean)
    .map((origin) => ` ${origin}`)
    .join('')

  // 打赏挂件（ko-fi）与分析脚本（cloudflareinsights）早已从界面里撤下，那两枚第三方源
  // 只剩在指令里占位；另一枚写死的 CloudFront 域名全站零引用。放行列表里留着没人用的源，
  // 等于把"谁能往这个页面里塞可执行内容"这件事交给一个已经没人负责的域名。
  const cspDirectives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${developmentScriptSource}${assetOrigin}`,
    "script-src-attr 'none'",
    `style-src 'self' 'unsafe-inline'${assetOrigin}`,
    `img-src 'self' data: blob:${extraMediaOrigins}${assetOrigin}`,
    `font-src 'self' data:${assetOrigin}`,
    `connect-src ${connectSrc}`,
    `media-src 'self' blob: ${PUBLIC_MEDIA_ORIGIN}${extraMediaOrigins}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'self'",
  ]

  if (isHttpsEnabled) {
    cspDirectives.push('upgrade-insecure-requests')
  }

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)

  const response = NextResponse.next({ request: { headers: requestHeaders } })

  response.headers.set('Content-Security-Policy', cspDirectives.join('; '))
  response.headers.set('X-DNS-Prefetch-Control', 'on')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'same-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()')

  if (isHttpsEnabled) {
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  }

  return response
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|brand|favicon|manifest\\.json|robots\\.txt|sw\\.js).*)']
}
