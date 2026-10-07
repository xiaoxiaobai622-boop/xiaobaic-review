import type { Metadata } from 'next'
import Link from 'next/link'
import { loadDocs } from '@/lib/marketing/content'
import { getSiteUrlFromRequest } from '@/lib/marketing/site-url'
import { BRAND } from '@/lib/marketing/brand'
import { HUBS, type HubGroup } from '@/lib/marketing/hubs'
import { JsonLd } from '@/components/marketing/JsonLd'

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
    title: hub.title,
    description: hub.description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      siteName: BRAND.zh,
      locale: 'zh_CN',
      title: hub.title,
      description: hub.description,
      url,
      images: [{ url: '/brand/logo.png', width: 256, height: 256, alt: BRAND.zh }],
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
        <Link
          href="/login"
          className="inline-flex items-center rounded-md bg-[#245fe7] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#1c4bcc]"
        >
          {CTA_LABEL}
        </Link>
      </p>

      {/* 未定价平台：schema 里不放 `offers`（2026-10-03 裁决 4）——`price: '0'` 等于向搜索引擎
          登记一个我们没对外承诺过的价格。这是内容口径，不是对计费代码状态的陈述。 */}
      <JsonLd
        value={{
          '@context': 'https://schema.org',
          '@type': 'SoftwareApplication',
          name: BRAND.zh,
          url: site,
          description: BRAND.description,
          applicationCategory: 'MultimediaApplication',
          operatingSystem: 'Web',
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
