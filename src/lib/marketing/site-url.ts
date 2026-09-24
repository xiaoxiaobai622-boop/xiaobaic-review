let cached: string | null = null

/** 站点绝对 origin，无尾斜杠。环境变量缺失时直接抛错——绝不能兜底成任何硬编码域名，
 *  否则换域名当天会静默产出一批 canonical 指向废弃域名的页面。 */
export function getSiteUrl(): string {
  if (cached) return cached
  const raw = process.env.NEXT_PUBLIC_APP_URL
  if (!raw) {
    throw new Error('NEXT_PUBLIC_APP_URL 未设置：SEO 绝对 URL（canonical/sitemap/og:image）无法生成')
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
