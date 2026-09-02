import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const DANGEROUS_PROTOCOL = /^(javascript|data|vbscript):/i
const PUBLIC_MEDIA_ORIGIN = 'https://mle6.cn'
const NEURALYN_ORIGIN = 'https://d8j0ntlcm91z4.cloudfront.net'

export async function proxy(request: NextRequest) {
  const url = request.nextUrl

  // Sanitize returnUrl on the login page
  if (url.pathname === '/login') {
    const returnUrl = url.searchParams.get('returnUrl')
    if (returnUrl && (!returnUrl.startsWith('/') || returnUrl.startsWith('//'))) {
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

  const connectSrc = [
    "'self'",
    'blob:',
    // hls.js fetches CDN-backed playlist segments through XHR/fetch, which
    // is governed by connect-src rather than media-src.
    mediaCdnOrigin,
    s3Origin,
    s3BucketOrigin,
    'https://ko-fi.com',
    'https://storage.ko-fi.com',
    'https://cloudflareinsights.com',
  ].filter(Boolean).join(' ')

  // Next/Turbopack's React development diagnostics use eval() for source
  // mapped call stacks. Keep this allowance development-only; production
  // remains nonce-based without unsafe-eval.
  const developmentScriptSource = process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''

  const cspDirectives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${developmentScriptSource} https://static.cloudflareinsights.com`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://storage.ko-fi.com https://*.ko-fi.com ${NEURALYN_ORIGIN}${mediaCdnOrigin ? ` ${mediaCdnOrigin}` : ''}${s3Origin ? ` ${s3Origin}` : ''}${s3BucketOrigin ? ` ${s3BucketOrigin}` : ''}`,
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    `media-src 'self' blob: ${PUBLIC_MEDIA_ORIGIN} ${NEURALYN_ORIGIN}${mediaCdnOrigin ? ` ${mediaCdnOrigin}` : ''}${s3Origin ? ` ${s3Origin}` : ''}${s3BucketOrigin ? ` ${s3BucketOrigin}` : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'self' https://ko-fi.com",
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
