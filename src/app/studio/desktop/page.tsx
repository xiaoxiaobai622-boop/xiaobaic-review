import { Apple, Globe, MonitorDown, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import BrandLogo from '@/components/BrandLogo'
import { Button } from '@/components/ui/button'
import { formatBytes, readDesktopRelease } from '@/lib/desktop-feed'

export const dynamic = 'force-dynamic'

/**
 * 窄栏那枚「桌面客户端」落地的页面。整页只有站内这一层栏面（`bg-popover`），深浅色全跟着主题走——
 * 上一版在浅色页面上横插一条深色展示带，他一句「一个页面两颜色」打回：拼色在这站里是首页那种
 * 营销面才用的手法，站内任务页就该是一个底。
 *
 * 主视觉用真截图（客户端里就是这一屏），靠描边＋投影立起来，不靠底色反差。
 * 版本／大小／日期／校验和全部服务端现读更新源的 latest.yml（见 src/lib/desktop-feed.ts）；
 * 读不到就整块换成一句实话，不许留一个上次缓存下来的版本号在这骗人。
 */
export default async function DesktopClientPage() {
  const release = await readDesktopRelease()
  const size = release ? formatBytes(release.sizeBytes) : null
  const releasedOn = release?.releasedAt?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null
  const meta = release
    ? [`版本 ${release.version}`, size, releasedOn ? `更新于 ${releasedOn}` : null].filter(Boolean).join(' · ')
    : null

  return (
    <div className="flex h-full min-h-0 flex-col bg-popover">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-[1120px] items-center gap-8 px-5 py-9 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:gap-12 lg:px-8 lg:py-12">
          <div className="min-w-0">
            <span className="flex h-[64px] w-[64px] items-center justify-center overflow-hidden rounded-[16px] border border-border bg-card px-3 shadow-elevation-sm">
              <BrandLogo size={38} className="max-w-full object-contain" ariaHidden />
            </span>
            <h1 className="mt-4 text-[28px] font-semibold leading-tight tracking-tight text-foreground">逐帧审阅桌面客户端</h1>
            <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
              和浏览器里打开的是同一个站点，装到 Windows 上常驻托盘：关窗口不退出，批注回复弹系统通知，发新版自己更新。
            </p>

            {release ? (
              <>
                <Button asChild className="mt-6 h-[46px] px-6 text-[15px]">
                  {/* /dl 是路由处理器（302 到带版本号的直链），不是页面：走 <Link> 会被客户端路由接管，
                      拿到的是一份 RSC 载荷而不是那一下跳转。 */}
                  {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                  <a href="/dl">
                    <MonitorDown className="mr-2 h-[18px] w-[18px]" aria-hidden />
                    下载 Windows 客户端
                  </a>
                </Button>
                <p className="mt-2.5 text-xs text-muted-foreground">{meta}</p>
              </>
            ) : (
              <p className="mt-6 max-w-[400px] rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
                暂时读不到客户端版本信息：更新源没答话，这里就不写版本号，免得给你一个过期的。稍等一会儿刷新这页。
              </p>
            )}

            <div className="mt-8 border-t border-border pt-6">
              <h2 className="text-sm font-semibold text-foreground">选择平台</h2>
              <div className="mt-1">
                <Row icon={<MonitorDown className="h-5 w-5" aria-hidden />} name="Windows" note="64 位安装包，装给当前用户">
                  {release ? (
                    <Button asChild size="sm">
                      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                      <a href="/dl">下载</a>
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">暂时读不到版本</span>
                  )}
                </Row>
                <Row muted icon={<Apple className="h-5 w-5" aria-hidden />} name="macOS" note="暂无发布计划">
                  <span className="text-xs text-muted-foreground">未提供</span>
                </Row>
                <Row icon={<Globe className="h-5 w-5" aria-hidden />} name="网页版" note="功能一致，无需安装">
                  <Button asChild size="sm" variant="outline">
                    <Link href="/studio/projects">打开</Link>
                  </Button>
                </Row>
              </div>
            </div>
          </div>

          <div className="min-w-0">
            <figure>
              {/* 这张图就是客户端里的那一屏（复用首页那张真截图）：客户端本身不另画界面。 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/home/hero-poster.jpg"
                width={1536}
                height={864}
                alt="客户端里的审阅工作台：左侧视频、右侧批注列表"
                className="w-full rounded-xl border border-border shadow-elevation-lg"
              />
              <figcaption className="mt-2.5 text-[11px] text-muted-foreground">
                客户端里就是这一屏：逐帧定位、批注线程、版本对比，和浏览器一致。
              </figcaption>
            </figure>

            <section className="mt-8">
              <h2 className="text-sm font-semibold text-foreground">装完之后</h2>
              <p className="mt-1 text-xs text-muted-foreground">这四件事和浏览器里不一样，装完值得知道。</p>
              <div className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2">
                {[
                  ['关窗口不是退出', '窗口收进系统托盘；要真退出走托盘或菜单里的「退出逐帧审阅」。'],
                  ['开机自启', '在应用菜单里勾上，之后开机自动在托盘待着。'],
                  ['批注回复提醒', '同事回复你的批注时弹系统通知，不用开着窗口。'],
                  ['自动更新', '发新版后客户端自己检查并下载安装，不用回来重新下包。'],
                ].map(([title, body]) => (
                  <div key={title}>
                    <p className="text-sm font-medium text-foreground">{title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</p>
                  </div>
                ))}
              </div>
            </section>

            <div className="mt-8 border-t border-border pt-5">
              <p className="flex items-start gap-2.5 text-sm leading-relaxed text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  安装包还没有代码签名：Windows 首次运行会拦一道 SmartScreen，点「更多信息」再点「仍要运行」即可。
                  装不上或者链接失效，用窄栏底部那颗灯泡反馈给运营。
                </span>
              </p>
              {release?.sha512 && (
                <p className="mt-3 break-all pl-[26px] font-mono text-[11px] leading-relaxed text-muted-foreground/80" title={release.sha512}>
                  SHA-512 {release.sha512}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({
  icon, name, note, muted, children,
}: {
  icon: React.ReactNode
  name: string
  note: string
  muted?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className={`flex items-center gap-3 border-b border-border py-3.5 last:border-b-0${muted ? ' opacity-55' : ''}`}>
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{name}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{note}</span>
      </span>
      <span className="shrink-0">{children}</span>
    </div>
  )
}
