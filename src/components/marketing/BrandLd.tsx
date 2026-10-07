import { getSiteUrlFromRequest } from '@/lib/marketing/site-url'
import { BRAND } from '@/lib/marketing/brand'
import { JsonLd } from '@/components/marketing/JsonLd'

/**
 * 品牌实体锚点。搜索引擎和大模型的回答引擎都要先把"这页是谁写的"消歧成图里的一个节点，
 * 才会把页面归到同一个品牌下引用；`@id` 用 `<site>/#organization` 这种稳定形态，
 * 内容页的 `Article.author` / `Article.publisher` 按同一个 `@id` 指回来（见 `DocPage.tsx`）。
 */
export async function BrandLd() {
  const site = await getSiteUrlFromRequest()
  const orgId = `${site}/#organization`
  return (
    <>
      <JsonLd
        value={{
          '@context': 'https://schema.org',
          '@type': 'Organization',
          '@id': orgId,
          name: BRAND.zh,
          alternateName: BRAND.en,
          url: site,
          description: BRAND.description,
          logo: { '@type': 'ImageObject', '@id': `${site}/#logo`, url: `${site}/brand/logo-512.png` },
        }}
      />
      <JsonLd
        value={{
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          '@id': `${site}/#website`,
          url: site,
          name: BRAND.zh,
          inLanguage: 'zh-CN',
          publisher: { '@id': orgId },
        }}
      />
    </>
  )
}
