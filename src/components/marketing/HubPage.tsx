import type { Metadata } from 'next'
import Link from 'next/link'
import { loadDocs } from '@/lib/marketing/content'
import { getSiteUrlFromRequest } from '@/lib/marketing/site-url'
import { BRAND } from '@/lib/marketing/brand'
import { JsonLd } from '@/components/marketing/JsonLd'

export type HubGroup = 'features' | 'compare'

/**
 * `/features` 与 `/compare` 唯一的文案表（三个字符串逐字来自计划 Task 7 Step 3，两页共用，
 * 不在页面文件里各写一份）。`blurb` 只当 `<h1>` 用；`title` 会套上根 layout 的 `%s | 逐帧审阅` 模板。
 * 下面列表里每条的标题与副文案不进这张表——它们直接读六篇文稿自己的 frontmatter `title` /
 * `description`，避免同一段话在仓库里存在两份、改稿时枢纽页悄悄过期。
 */
const HUBS: Record<HubGroup, { title: string; description: string; blurb: string }> = {
  features: {
    title: '功能',
    description: '逐帧批注、版本记录、带密码的审片链接——影视团队交付时用得到的部分。',
    blurb: '交付一条片子会用到的几件事',
  },
  compare: {
    title: '对比',
    description: '和网盘微信、和分秒帧、和 Frame.io 的实质差异，含各自更适合的场景。',
    blurb: '现在这套流程哪里卡',
  },
}

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
