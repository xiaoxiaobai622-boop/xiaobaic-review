/**
 * 桌面客户端「当前是哪一版」只有一个出处：更新源里的 latest.yml。
 *
 * 为什么不缓存这个结果：安装包在 CDN 按扩展名边缘缓存 30 天，而 `latest.yml` 本来就在不缓存
 * 名单里——「现在发的是哪一版」这个事实只能现读，读一次是一次。`/dl` 的跳转和
 * `/studio/desktop` 的展示共用这一份，两边各写一遍正则迟早会漂（一边跳新版、一边写旧版本号）。
 */
export const DESKTOP_FEED_URL = process.env.DESKTOP_FEED_URL ?? 'https://dl.vidx.cn/desktop/'

export type DesktopRelease = {
  version: string
  file: string
  url: string
  /** 安装包字节数。清单里没写就是 null——界面不许拿 0 冒充「0 MB」。 */
  sizeBytes: number | null
  /** 发布日期原文（ISO 串），格式化留给界面，这里不编日期。 */
  releasedAt: string | null
  sha512: string | null
}

const FETCH_TIMEOUT_MS = 10_000

/** 读不到（网络失败、超时、清单缺字段）一律返回 null，由调用方决定怎么如实说。 */
export async function readDesktopRelease(): Promise<DesktopRelease | null> {
  try {
    const response = await fetch(`${DESKTOP_FEED_URL}latest.yml`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!response.ok) return null
    const yml = await response.text()
    // 顶层键不缩进，所以这两个 ^ 锚定的正则捞不到 files[] 里那些缩进的同名键。
    const file = yml.match(/^path:\s*(\S+)\s*$/m)?.[1] ?? null
    const version = yml.match(/^version:\s*([\d.]+)\s*$/m)?.[1] ?? null
    if (!file || !version) return null
    const size = yml.match(/^\s+size:\s*(\d+)\s*$/m)?.[1] ?? null
    return {
      version,
      file,
      url: `${DESKTOP_FEED_URL}${file}`,
      sizeBytes: size === null ? null : Number(size),
      releasedAt: yml.match(/^releaseDate:\s*'?([^'\n]+?)'?\s*$/m)?.[1] ?? null,
      sha512: yml.match(/^sha512:\s*(\S+)\s*$/m)?.[1] ?? null,
    }
  } catch {
    return null
  }
}

/** 112,073,851 字节 → 「106.9 MB」；拿不到字节数就返回 null，界面那一格直接不画。 */
export function formatBytes(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes) || bytes <= 0) return null
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
