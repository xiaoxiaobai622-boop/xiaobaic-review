import type { MetadataRoute } from 'next'
import { getSiteUrlFromRequest } from '@/lib/marketing/site-url'

/**
 * 抓取规则的唯一来源（`public/robots.txt` 那份已作废：它只有 `/admin/` 这条废规则）。
 *
 * `Sitemap` 按协议必须是绝对 URL，而且它的 origin 必须和页面 canonical 用同一个来源，
 * 否则同一份索引里会出现两个域名。所以这里走 `getSiteUrlFromRequest()`，不写任何域名字面量。
 *
 * 形参没用：`next/dist/build/webpack/loaders/next-metadata-route-loader.js:124` 生成的
 * `export async function GET()` 是**零参调用** `handler()`，请求上下文只经 `next/headers`
 * 的 AsyncLocalStorage 传进来——`robots.ts` 本质是个 route handler，所以 `headers()` 拿得到 host，
 * 但显式收 `request` 只会收到 `undefined`。
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const site = await getSiteUrlFromRequest()

  /**
   * `customFavicon` 在管理端上传后被硬编码成 `/api/branding/favicon`（`api/settings/favicon/route.ts:149`），
   * 每页 `<head>` 的三条 icon 声明都指向它。`Disallow: /api/` 会把这条连带拦掉：爬虫取不到图标，
   * 搜索结果只能画一枚通用地球。所以单独放行这一条精确前缀——放行的是图标接口本身，
   * `/api/` 下其余路径的规则一字未动。
   *
   * 胜出靠的是「最长前缀匹配」（RFC 9309 §2.3.1.3，Google/Bing/百度实现一致），不是行序；
   * Next 会把整组 `allow` 印在 `disallow` 之前，两行谁在前都不改变判定。
   */
  const allow = ['/', '/api/branding/favicon']

  /**
   * `/login` 故意不在下面这张表里。`Disallow` 和 `<meta name="robots" content="noindex">` 会互相
   * 抵消：爬虫抓不到页面，就永远读不到那行 noindex，搜索引擎退化成"凭外链把 URL 收进索引、不带摘要"。
   * `/login` 是全站唯一被公开外站链接指向的应用路由（六篇文稿的 CTA 都指向它），而
   * `src/app/login/layout.tsx` 已经给了真 noindex —— 所以要的是"可抓 + noindex"。
   * 同一个理由适用于 `/portal`、`/profile`、`/onboarding`：这三条各自的 layout 里写着
   * `robots: { index: false, follow: false }`（`portal/layout.tsx:8`、`profile/layout.tsx:7`、
   * `onboarding/layout.tsx:7`），所以它们**不进**这张表；把能自己声明 noindex 的路径再 Disallow 一遍，
   * 等于花掉抓取机会去换一个已经生效的指令。
   * 表里的路径**一律不带尾斜杠**：`Disallow: /studio/` 匹配不到裸 `/studio`，而裸路径实测 200 可抓
   * （`/studio`、`/platform`、`/device` 三段都真实存在），前缀写法会留下一个刚好没人看的缝。
   * `/api/`、`/share/`、`/lab/` 保持带斜杠——它们没有"裸路径本身可看"的形态。
   * `/lab/` 是设计实验页，不给抓；`/privacy`、`/terms` 要能被抓（它们在 sitemap 里）。
   */
  const disallow = [
    '/studio',
    '/platform',
    '/device',
    '/lab/',
    '/forgot-password',
    '/reset-password',
    '/wechat-mini-login',
    '/unsubscribe',
    '/api/',
    '/share/',
  ]

  return {
    rules: [{ userAgent: '*', allow, disallow }],
    sitemap: `${site}/sitemap.xml`,
  }
}
