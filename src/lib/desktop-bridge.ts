/**
 * 桌面客户端（Electron）注入的 window.vidxDesktop 桥。
 * 浏览器里桥不存在，getDesktopBridge() 返回 null，所有调用点据此保持原有行为。
 * 契约需与客户端仓库 src/preload/vidx-desktop.d.ts 同步。
 */

export interface VidxDesktopAppInfo {
  version: string
  platform: string
  electron: string
  appUrl: string
}

export interface VidxDesktopNotifyOptions {
  title: string
  body?: string
  /** 站内路径（以 / 开头）。点通知时客户端把窗口带回这一页。 */
  href?: string
}

export interface VidxDesktopBridge {
  isDesktop: true
  getAppInfo(): Promise<VidxDesktopAppInfo>
  notify(options: VidxDesktopNotifyOptions): void
  onDeepLink(callback: (url: string) => void): () => void
  onUpdateDownloaded(callback: (info: { version: string }) => void): () => void
  installUpdate(): Promise<void>
}

declare global {
  interface Window {
    vidxDesktop?: VidxDesktopBridge
  }
}

export function getDesktopBridge(): VidxDesktopBridge | null {
  if (typeof window === 'undefined') return null
  return window.vidxDesktop ?? null
}

/** 客户端点通知时送来 `vidx://open?url=<站内路径>`，不是这一形态就交回 null。 */
export function parseDesktopDeepLink(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'vidx:' || parsed.hostname !== 'open') return null
    const href = parsed.searchParams.get('url')
    // 只收站内绝对路径：`//host` 形态会被 router 当成外部地址跳出去。
    if (!href?.startsWith('/') || href.startsWith('//')) return null
    return href
  } catch {
    return null
  }
}
