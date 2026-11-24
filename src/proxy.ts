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

  // The open-tag page loads WeChat's JS-SDK from its own CDN. Nonces alone are
  // not reliable for that external script in every WeChat WebView, so allow the
  // origin only on the handoff pages.
  const isWechatHandoffPath = url.pathname.startsWith('/open/') || url.pathname.startsWith('/handoff/')
  const wechatSdkOrigin = isWechatHandoffPath ? ' https://res.wx.qq.com' : ''
  // 开放标签由微信以 *.qq.com / webcompt: 组件渲染；frame-src 不放行时标签静默不渲染。
  const wechatOpenTagFrameSrc = isWechatHandoffPath ? ' https://*.qq.com webcompt:' : ''
  // 项目工作区的「文档」页要嵌 office.vidx.cn 的编辑器并调用其文档 API。
  const isDocsEmbedPage = /^\/studio\/projects\/[^/]+$/.test(url.pathname)
  const docsEmbedSrc = isDocsEmbedPage ? ' https://office.vidx.cn' : ''

  const connectSrc = [
    "'self'",
    'blob:',
    // hls.js fetches CDN-backed playlist segments through XHR/fetch, which
    // is governed by connect-src rather than media-src.
    mediaCdnOrigin,
    s3Origin,
    s3BucketOrigin,
    docsEmbedSrc,
  ].filter(Boolean).join(' ')

  // Next/Turbopack's React development diagnostics use eval() for source
  // mapped call stacks. Keep this allowance development-only; production
  // remains nonce-based without unsafe-eval.
  const developmentScriptSource = process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''

  // 公告/新增功能允许运营粘贴外链图片（校验仍只收 http/https）。这里只放宽被动图片加载，
  // 脚本与 connect-src 不放宽；生产页面是 https，http 图片会被浏览器按混合内容拦截，
  // 所以 http 只在本地开发放行。
  const externalImageSource = process.env.NODE_ENV === 'development' ? ' https: http:' : ' https:'

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
    `script-src 'self' 'nonce-${nonce}'${developmentScriptSource}${assetOrigin}${wechatSdkOrigin}`,
    "script-src-attr 'none'",
    `style-src 'self' 'unsafe-inline'${assetOrigin}`,
    `img-src 'self' data: blob:${externalImageSource}${extraMediaOrigins}${assetOrigin}`,
    `font-src 'self' data:${assetOrigin}`,
    `connect-src ${connectSrc}`,
    `media-src 'self' blob: ${PUBLIC_MEDIA_ORIGIN}${extraMediaOrigins}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `frame-src 'self'${wechatOpenTagFrameSrc}${docsEmbedSrc}`,
  ]

  if (isHttpsEnabled) {
    cspDirectives.push('upgrade-insecure-requests')
  }

  // 小程序 web-view 用的客服页需要允许被嵌入（开发者工具的 web-view 是 iframe 实现），
  // 其余页面维持 DENY。只对 /support 放开，避免全站失去点击劫持防护。
  const isSupportEmbed = url.pathname === '/support' || url.pathname.startsWith('/support/')
  const csp = (isSupportEmbed
    ? cspDirectives.map((directive) => (directive.startsWith('frame-ancestors') ? "frame-ancestors *" : directive))
    : cspDirectives).join('; ')

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)

  // `/whats-new/category` has no category to render; rewrite to an ungenerated slug so
  // Next returns its real 404 status instead of a streamed 200 shell.
  const categoryIndexMiss = url.pathname === '/whats-new/category' || url.pathname === '/whats-new/category/'
  const response = categoryIndexMiss
    ? NextResponse.rewrite(new URL('/whats-new/category/__not-found__', url))
    : NextResponse.next({ request: { headers: requestHeaders } })

  response.headers.set('Content-Security-Policy', csp)
  response.headers.set('X-DNS-Prefetch-Control', 'on')
  if (!isSupportEmbed) response.headers.set('X-Frame-Options', 'DENY')
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
