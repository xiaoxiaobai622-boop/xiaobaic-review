import { headers } from 'next/headers'

let cached: string | null = null

/** 站点绝对 origin，无尾斜杠。环境变量缺失时直接抛错——绝不能兜底成任何硬编码域名，
 *  否则换域名当天会静默产出一批 canonical 指向废弃域名的页面。
 *
 *  2026-10-03 裁决 3 的补语：`NEXT_PUBLIC_APP_URL` 没值时，production 仍旧抛上面那句原文；
 *  只有非 production 才允许退回调用方给的 `fallbackOrigin`（也就是请求自己的 origin）。
 *  退路不是覆盖——env 有值时一律以 env 为准；退路也不兜底任何域名字面量，它只接受真实 host
 *  拼出来的值，本机 `127.0.0.1:3000` 与 `localhost:3000` 各自跟着请求走。 */
export function getSiteUrl(fallbackOrigin?: string | null): string {
  if (cached) return cached
  const raw = process.env.NEXT_PUBLIC_APP_URL
  if (!raw) {
    // 没传退路值（`robots.ts`/`sitemap.ts` 这类非请求调用点）时报的必须是真原因，
    // 不能指向一个根本不存在的 origin。
    if (process.env.NODE_ENV === 'production' || !fallbackOrigin?.trim()) {
      throw new Error('NEXT_PUBLIC_APP_URL 未设置：SEO 绝对 URL（canonical/sitemap/og:image）无法生成')
    }
    return normalizeFallbackOrigin(fallbackOrigin)
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`NEXT_PUBLIC_APP_URL 不是合法绝对 URL：${raw}`)
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error(`NEXT_PUBLIC_APP_URL 协议必须是 http/https：${raw}`)
  cached = url.origin
  return cached
}

/** 归一化统一走 `new URL(x).origin`，与 `scripts/seo-check.mjs:5` 口径一致（剥尾斜杠与路径前缀）。
 *  注意这里**不写 `cached`**：dev 下同一进程会交替收到 `127.0.0.1:3000` 和 `localhost:3000` 两种 host，
 *  缓存一次请求的 origin 等于把它漏给后续所有请求。 */
function normalizeFallbackOrigin(fallbackOrigin: string | null | undefined): string {
  const invalid = (): Error =>
    new Error(
      `非 production 退路拿到的 origin 不合法：${String(fallbackOrigin)}（应为 http/https 绝对 URL，且只能来自请求的 host）`,
    )
  if (!fallbackOrigin || !fallbackOrigin.trim()) throw invalid()
  let url: URL
  try {
    url = new URL(fallbackOrigin)
  } catch {
    throw invalid()
  }
  if (!/^https?:$/.test(url.protocol) || !url.host) throw invalid()
  return url.origin
}

/** 只在有请求上下文的地方用（营销路由的 metadata；robots/sitemap 请直接用 `getSiteUrl()`）。 */
export async function getSiteUrlFromRequest(): Promise<string> {
  const requestHeaders = await headers()
  const host = requestHeaders.get('host')
  const forwardedProto = requestHeaders
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
  const proto = forwardedProto || (process.env.NODE_ENV === 'production' ? 'https' : 'http')
  return getSiteUrl(host ? `${proto}://${host}` : null)
}
