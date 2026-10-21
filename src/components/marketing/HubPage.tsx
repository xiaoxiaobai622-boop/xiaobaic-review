import type { Metadata } from 'next'
import Link from 'next/link'
import { loadDocs } from '@/lib/marketing/content'
import { getSiteUrlFromRequest } from '@/lib/marketing/site-url'
import { BRAND } from '@/lib/marketing/brand'
import { HUBS, type HubGroup } from '@/lib/marketing/hubs'
import { JsonLd } from '@/components/marketing/JsonLd'
import MarketingCta from '@/components/marketing/MarketingCta'

/**
 * `/features` 与 `/compare` 的文案表在 `src/lib/marketing/hubs.ts`（`/llms.txt` 路由也要读它，
 * 所以不放这个文件里）。
 */

/** 六篇 CTA 的同一句文案（`.sdd/facts-adjudicated.md` §2 裁决：不承诺登录方式）。 */
const CTA_LABEL = '登录后建一个团队，传一条片子试'

/**
 * `robots` 必须 `index` 与 `follow` 同时写：`resolve-metadata.js` 对子级是整字段替换、
 * 没有深合并，只写 `index: true` 会把根 layout 的 `follow: true` 一起丢掉。
 * `openGraph` 同理是整块替换，所以带 openGraph 就必须把 `images` 再写一遍，否则 og:image 消失。
 */
export async function hubMetadata(group: HubGroup): Promise<Metadata> {
  const hub = HUBS[group]
  const site = await getSiteUrlFromRequest()
  const url = `${site}/${group}`
  return {
    // `<title>` 用带品类词的长标题；导航、面包屑、llms.txt 仍用短的 `hub.title`。
    title: hub.seoTitle,
    description: hub.description,
    keywords: [...BRAND.keywords],
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      siteName: BRAND.zh,
      locale: 'zh_CN',
      title: hub.seoTitle,
      description: hub.description,
      url,
      images: [{ url: '/og/brand-1200x630.png', width: 1200, height: 630, alt: BRAND.zh }],
    },
    robots: { index: true, follow: true },
  }
}

export async function HubPage({ group }: { group: HubGroup }) {
  const hub = HUBS[group]
  const site = await getSiteUrlFromRequest()
  const url = `${site}/${group}`
  const docs = [...loadDocs().values()].filter((d) => d.group === group)

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-10 sm:py-14">
      <h1 className="text-3xl font-bold leading-snug text-[#171a20] sm:text-4xl">{hub.blurb}</h1>
      <p className="mt-4 text-[15px] leading-7 text-[#3f4550]">{hub.description}</p>

      <ul className="mt-8 space-y-3">
        {docs.map((d) => (
          <li key={`${d.group}/${d.slug}`} className="rounded-lg border border-[#dfe2e7] bg-white px-4 py-4">
            <Link
              href={`/${d.group}/${d.slug}`}
              className="text-[15px] font-semibold text-[#245fe7] hover:underline"
            >
              {d.title}
            </Link>
            <p className="mt-1 text-sm leading-6 text-[#6f7580]">{d.description}</p>
          </li>
        ))}
      </ul>

      <p className="mt-9">
        <MarketingCta href="/login" label={CTA_LABEL} />
      </p>

      {/* `SoftwareApplication` 已挪进 `BrandLd`（营销 layout 每页都带），这里不再出第二个同名节点。 */}
      <JsonLd
        value={{
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          // 不能用 `#hub`：`DocPage` 的 `Article.isPartOf` 已经把 `#hub` 声明成 CollectionPage。
          '@id': `${url}#list`,
          name: hub.seoTitle,
          itemListElement: docs.map((d, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            name: d.title,
            url: `${site}/${d.group}/${d.slug}`,
          })),
        }}
      />

      <JsonLd
        value={{
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: BRAND.zh, item: site },
            { '@type': 'ListItem', position: 2, name: hub.title, item: url },
          ],
        }}
      />
    </div>
  )
}
