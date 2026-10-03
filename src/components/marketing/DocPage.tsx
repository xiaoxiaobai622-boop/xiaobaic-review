import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { escapeHtml, getDoc, loadDocs, type MarketingDoc } from '@/lib/marketing/content'
import { getSiteUrlFromRequest } from '@/lib/marketing/site-url'
import { BRAND } from '@/lib/marketing/brand'
import { MarkdownBody } from '@/components/marketing/MarkdownBody'
import { JsonLd } from '@/components/marketing/JsonLd'

/**
 * `/compare/*` 与 `/features/*` 共用。视觉语言照 `src/components/LegalDoc.tsx`：浅底、
 * max-w-3xl、15px/leading-7、细边框，不自创深色大圆角那套。
 *
 * `robots` 必须同时写 `index` 与 `follow`：`resolve-metadata.js` 对子级是整体替换而不是
 * 深合并，只写 `index` 会把根 layout 的 `follow: true` 一起丢掉。
 */
export async function docMetadata(group: string, slug: string): Promise<Metadata> {
  const doc = getDoc(group, slug)
  if (!doc) return { title: '页面不存在', robots: { index: false, follow: true } }
  const site = await getSiteUrlFromRequest()
  const url = `${site}/${group}/${slug}`
  return {
    title: doc.title,
    description: doc.description,
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      title: doc.title,
      description: doc.description,
      url,
      publishedTime: doc.updatedOn,
      // `resolve-metadata.js` 的 `case 'openGraph'` 是整体替换，不是深合并：这一页一旦带
      // openGraph，layout 那份（含 images）就整块被顶掉，og:image 会直接消失。所以 images
      // 必须在页级再写一遍，和 `(marketing)/layout.tsx` 保持同一张图。
      images: [{ url: '/brand/logo.png', width: 256, height: 256, alt: BRAND.zh }],
    },
    robots: { index: true, follow: true },
  }
}

/** 渲染器出来的正文没有 class，所以排版全挂在外层容器上（Tailwind 的后代任意变体）。 */
const PROSE =
  'text-[15px] leading-7 text-[#3f4550] [&_a]:text-[#245fe7] [&_a]:underline [&_a]:underline-offset-2 '
  + '[&_blockquote]:my-5 [&_blockquote]:border-l-2 [&_blockquote]:border-[#dfe2e7] [&_blockquote]:pl-4 [&_blockquote]:text-[#6f7580] '
  + '[&_code]:rounded-[3px] [&_code]:bg-[#eef0f4] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_code]:text-[#171a20] '
  + '[&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-[#171a20] '
  + '[&_h3]:mt-7 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-[#171a20] '
  + '[&_li]:mt-1 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mt-4 '
  + '[&_table]:my-6 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-[#dfe2e7] [&_td]:px-3 [&_td]:py-2 [&_td]:align-top '
  + '[&_th]:border [&_th]:border-[#dfe2e7] [&_th]:bg-white [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold '
  + '[&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-5'

export async function DocPage({
  group,
  params,
}: {
  group: 'compare' | 'features'
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const doc = getDoc(group, slug)
  if (!doc) notFound()
  // related 写的是 group/slug，这里换成对方的 title；查不到的直接跳过不渲染。
  const docs = loadDocs()
  const related = doc.related
    .map((key) => docs.get(key))
    .filter((item): item is MarketingDoc => item !== undefined)

  return (
    <article className="mx-auto w-full max-w-3xl px-5 py-10 sm:py-14">
      {/* 与正文同一套「只转义 &<>」的口径：React 文本节点会把 h1 里的直引号写成 `&quot;`，
          而 SEO 契约要求 H1 逐字含 `意见挂在第几帧，不是"大概三分钟"`。h1 只来自受审文稿。 */}
      <h1
        className="text-3xl font-bold leading-snug text-[#171a20] sm:text-4xl"
        dangerouslySetInnerHTML={{ __html: escapeHtml(doc.h1) }}
      />

      <div className={`mt-8 ${PROSE}`}>
        <MarkdownBody html={doc.bodyHtml} />
      </div>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-[#171a20]">常见问题</h2>
        <dl className="mt-4 space-y-4">
          {doc.faq.map((f) => (
            <div key={f.q}>
              <dt className="text-[15px] font-medium text-[#171a20]">{f.q}</dt>
              <dd className="mt-1 text-[15px] leading-7 text-[#3f4550]">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="mt-9">
        <Link
          href={doc.cta.href}
          className="inline-flex items-center rounded-md bg-[#245fe7] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#1c4bcc]"
        >
          {doc.cta.label}
        </Link>
      </p>

      {related.length > 0 && (
        <nav aria-label="相关页面" className="mt-9 border-t border-[#dfe2e7] pt-5">
          <p className="text-xs font-semibold text-[#6f7580]">相关页面</p>
          <ul className="mt-3 space-y-2">
            {related.map((r) => (
              <li key={`${r.group}/${r.slug}`}>
                <Link href={`/${r.group}/${r.slug}`} className="text-[15px] text-[#245fe7] hover:underline">
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <JsonLd
        value={{
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: doc.faq.map((f) => ({
            '@type': 'Question',
            name: f.q,
            acceptedAnswer: { '@type': 'Answer', text: f.a },
          })),
        }}
      />

      <p className="mt-8 border-t border-[#dfe2e7] pt-4 text-xs text-[#8b919b]">
        {/* 这句只交代文稿本身的核稿日。竞品那几处的核实日期在正文里逐条带着（依据 URL + 核实于），
            两个日期不是一回事，别让这一行替它们背书。 */}
        文稿最后核对于 {doc.updatedOn}　·　{BRAND.zh}（{BRAND.en}）
      </p>
    </article>
  )
}
