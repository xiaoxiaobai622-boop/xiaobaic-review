import type { MetadataRoute } from 'next'
import { loadDocs } from '@/lib/marketing/content'
import { getSiteUrlFromRequest } from '@/lib/marketing/site-url'

/**
 * 只收 200 打得开、并且允许索引的 URL：首页 + 两个枢纽 + 隐私/条款 + 六篇文稿 + 内测公告。
 * `/login`（noindex）、`/studio`、`/share`、`/[shareCode]` 短链一律不进——进了就等于邀请
 * 搜索引擎去索引 robots 里已经 Disallow 的东西。
 *
 * 绝对前缀与页面 canonical 同源，都来自 `getSiteUrlFromRequest()`；这里不写任何域名字面量。
 * `loadDocs()` 是同步的（返回 `Map`，进程内缓存），别 `await`。
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = await getSiteUrlFromRequest()
  // 固定核稿日；不得把每次请求/构建时间冒充内容更新。
  const reviewedOn = '2026-11-07'

  // 首页这条**不带尾斜杠**：Next 渲染根路径 canonical 时会把 `https://vidx.cn/` 归一成
  // `https://vidx.cn`（10-09 线上实测），两边不一致就等于给同一个页面两个地址。
  const statics: MetadataRoute.Sitemap = [
    { url: site, lastModified: reviewedOn, images: [`${site}/home/review-comments.webp`, `${site}/home/versions-grid.webp`, `${site}/home/collect-upload.webp`] },
    { url: `${site}/features`, lastModified: reviewedOn },
    { url: `${site}/compare`, lastModified: reviewedOn },
    { url: `${site}/guides`, lastModified: reviewedOn },
    { url: `${site}/privacy`, lastModified: reviewedOn },
    { url: `${site}/terms`, lastModified: reviewedOn },
  ]

  // 文稿使用 frontmatter 的真实核稿日期；有配图的把图片一并交给图片索引。
  const docs: MetadataRoute.Sitemap = [...loadDocs().values()].map((d) => ({
    url: `${site}/${d.group}/${d.slug}`,
    lastModified: new Date(d.updatedOn),
    images: d.illustration ? [`${site}${d.illustration.src}`] : undefined,
  }))

  // 内测公告：营销导航与审片页横幅都链向它、页面自带 index + canonical，此前却漏在 sitemap 外。
  // 日期与页内 `<time>` / `article:modified_time` 同值（`news/beta/page.tsx`）。
  const news: MetadataRoute.Sitemap = [{ url: `${site}/news/beta`, lastModified: new Date('2026-11-07') }]

  return [...statics, ...docs, ...news]
}
