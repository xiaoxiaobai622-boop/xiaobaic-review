import type { Metadata } from 'next'
import Link from 'next/link'
import { BRAND } from '@/lib/marketing/brand'
import { getSiteUrlFromRequest } from '@/lib/marketing/site-url'
import { JsonLd } from '@/components/marketing/JsonLd'

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteUrlFromRequest()
  const url = `${site}/news/beta`
  return {
    title: '逐帧审阅成长计划内测公告',
    description: '逐帧审阅成长计划内测已于 2026 年 10 月 1 日正式开始。',
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      title: '逐帧审阅成长计划内测公告',
      description: '逐帧审阅成长计划内测已于 2026 年 10 月 1 日正式开始。',
      url,
      publishedTime: '2026-10-20',
      modifiedTime: '2026-10-20',
      images: [{ url: '/og/brand-1200x630.png', width: 1200, height: 630, alt: BRAND.zh }],
    },
    robots: { index: true, follow: true },
  }
}

export default async function BetaAnnouncementPage() {
  const site = await getSiteUrlFromRequest()
  const url = `${site}/news/beta`

  return (
    <article className="mx-auto w-full max-w-3xl px-5 py-10 sm:py-14">
      <div className="rounded-lg border border-[#dfe2e7] bg-white px-6 py-8 sm:px-10 sm:py-12">
        <header>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded bg-[#eef3ff] px-2 py-1 text-[11px] font-semibold tracking-[0.08em] text-[#245fe7]">
              内测公告
            </span>
            <span className="text-[11px] font-medium tracking-[0.16em] text-[#6f7580]">BETA</span>
          </div>

          <h1 className="mt-5 text-balance text-3xl font-bold leading-snug text-[#171a20] sm:text-4xl">
            欢迎加入<span className="whitespace-nowrap">逐帧审阅</span>成长计划内测
          </h1>

          <p className="mt-5 max-w-2xl text-base leading-8 text-[#3f4550] sm:text-[17px]">
            逐帧审阅成长计划内测已于 2026 年 10 月 1 日正式开始。感谢每一位参与和支持逐帧审阅的用户，欢迎你和我们一起把产品做得更好。
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-[#6f7580]">
            <time dateTime="2026-10-20">2026 年 10 月 20 日</time>
            <span aria-hidden="true">·</span>
            <span>南宁轻创社科技有限公司</span>
          </div>
        </header>

        <div className="mt-10 space-y-10 text-[15px] leading-8 text-[#3f4550]">
          <section aria-labelledby="beta-quota">
            <h2 id="beta-quota" className="text-lg font-semibold text-[#171a20]">当前内测额度</h2>
            <dl className="mt-4 grid grid-cols-2 divide-x divide-[#dfe2e7] rounded-lg bg-[#f6f8fc] px-4 py-4 sm:px-6 sm:py-5">
              <div className="pr-4 sm:pr-6">
                <dt className="text-xs text-[#6f7580]">存储空间</dt>
                <dd className="mt-1 text-2xl font-semibold tracking-tight text-[#171a20]">10 GB</dd>
              </div>
              <div className="pl-4 sm:pl-6">
                <dt className="text-xs text-[#6f7580]">团队席位（最多）</dt>
                <dd className="mt-1 text-2xl font-semibold tracking-tight text-[#171a20]">5 人</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="beta-more">
            <h2 id="beta-more" className="text-lg font-semibold text-[#171a20]">额度不够怎么办？</h2>
            <p className="mt-3">
              如果在使用过程中遇到存储空间或团队席位不够的情况，可以点击左侧窄栏底部的「<strong className="font-semibold text-[#171a20]">帮助</strong>」按钮，在面板里选择「联系客服」联系我们。我们会根据你的实际使用需求，适当提供更大的存储额度或更多席位。
            </p>
          </section>

          <section aria-labelledby="beta-together">
            <h2 id="beta-together" className="text-lg font-semibold text-[#171a20]">一起把产品做得更好</h2>
            <p className="mt-3">
              逐帧审阅还在不断成长中。我们也会为符合条件的用户提供进一步的内测支持，期待与你一起持续打磨每一个使用细节。
            </p>
          </section>

          <p className="border-t border-[#eef0f3] pt-6">
            感谢每一位参与和支持逐帧审阅的用户。<br />
            <strong className="font-semibold text-[#171a20]">逐帧审阅，与每一帧共同进步。</strong>
          </p>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
          <Link
            href="/login"
            className="inline-flex items-center rounded-md bg-[#245fe7] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#1c4bcc]"
          >
            加入内测
          </Link>
          <Link href="/" className="text-sm text-[#6f7580] transition-colors hover:text-[#171a20]">
            返回首页
          </Link>
        </div>

        <JsonLd
          value={{
            '@context': 'https://schema.org',
            '@type': 'Article',
            '@id': `${url}#article`,
            headline: '欢迎加入逐帧审阅成长计划内测',
            name: '逐帧审阅成长计划内测公告',
            description: '逐帧审阅成长计划内测已于 2026 年 10 月 1 日正式开始。',
            inLanguage: 'zh-CN',
            datePublished: '2026-10-20',
            dateModified: '2026-10-20',
            author: { '@id': `${site}/#organization` },
            publisher: { '@id': `${site}/#organization` },
            mainEntityOfPage: { '@type': 'WebPage', '@id': url },
            url,
          }}
        />
      </div>
    </article>
  )
}
