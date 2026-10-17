/**
 * 把外部可控的 `returnUrl` 收敛成"本站内的一个路径"。
 *
 * 原先三处各自写的是 `value.startsWith('/') && !value.startsWith('//')`，那挡不住反斜杠：
 * WHATWG 的 URL 解析把 `\` 当 `/`，所以 `/\evil.com` 既过了这个谓词、又会被解析成
 * `https://evil.com/`（实测 `new URL('/\\evil.com','https://vidx.cn')`）。浏览器在
 * `location.href = '/\\evil.com'` 上做的是同一套解析，于是登录页与微信回调都成了开放重定向。
 *
 * 判据因此不能只看字符串前缀：归一化反斜杠 → 拒协议相对 → 再按真实解析验一次 origin。
 */
const PLACEHOLDER_ORIGIN = 'https://return-url.invalid'

export function safeReturnUrl(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback

  // 控制字符与空白会在后续解析里被剥掉，先拒掉，免得 " /evil.com" 这类绕过前缀判断
  if (/[\u0000-\u001f\u007f\s]/.test(value)) return fallback

  const normalized = value.replace(/\\/g, '/')
  if (!normalized.startsWith('/') || normalized.startsWith('//')) return fallback

  let parsed: URL
  try {
    parsed = new URL(normalized, PLACEHOLDER_ORIGIN)
  } catch {
    return fallback
  }
  if (parsed.origin !== PLACEHOLDER_ORIGIN) return fallback

  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}
