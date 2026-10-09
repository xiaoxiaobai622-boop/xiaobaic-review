import type { MetadataRoute } from 'next'
import { loadDocs } from '@/lib/marketing/content'
import { getSiteUrlFromRequest } from '@/lib/marketing/site-url'

/**
 * 只收 200 打得开、并且允许索引的 URL：首页 + 两个枢纽 + 隐私/条款 + 六篇文稿。
 * `/login`（noindex）、`/studio`、`/share`、`/[shareCode]` 短链一律不进——进了就等于邀请
 * 搜索引擎去索引 robots 里已经 Disallow 的东西。
 *
 * 绝对前缀与页面 canonical 同源，都来自 `getSiteUrlFromRequest()`；这里不写任何域名字面量。
 * `loadDocs()` 是同步的（返回 `Map`，进程内缓存），别 `await`。
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = await getSiteUrlFromRequest()
  const now = new Date()

  // 首页这条**不带尾斜杠**：Next 渲染根路径 canonical 时会把 `https://vidx.cn/` 归一成
  // `https://vidx.cn`（10-09 线上实测），两边不一致就等于给同一个页面两个地址。
  const statics: MetadataRoute.Sitemap = [site, `${site}/features`, `${site}/compare`, `${site}/privacy`, `${site}/terms`].map(
    (url) => ({ url, lastModified: now }),
  )

  // 文稿带 frontmatter 的 `updatedOn`，比"现在"诚实；其余条目没有维护日期，只能用生成时间。
  const docs: MetadataRoute.Sitemap = [...loadDocs().values()].map((d) => ({
    url: `${site}/${d.group}/${d.slug}`,
    lastModified: new Date(d.updatedOn),
  }))

  return [...statics, ...docs]
}
