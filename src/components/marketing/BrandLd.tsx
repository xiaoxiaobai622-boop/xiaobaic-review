import { getSiteUrlFromRequest } from '@/lib/marketing/site-url'
import { BRAND, BRAND_FEATURES } from '@/lib/marketing/brand'
import { JsonLd } from '@/components/marketing/JsonLd'

/**
 * 品牌实体锚点。搜索引擎和大模型的回答引擎都要先把"这页是谁写的"消歧成图里的一个节点，
 * 才会把页面归到同一个品牌下引用；`@id` 用 `<site>/#organization` 这种稳定形态，
 * 内容页的 `Article.author` / `Article.publisher` 按同一个 `@id` 指回来（见 `DocPage.tsx`）。
 *
 * `SoftwareApplication` 原来只在两个枢纽页上，首页反而没有——而回答引擎回答
 * 「推荐几个视频审片工具」时最先读的就是首页。现在跟品牌节点放一起，全站共用同一个 `@id`。
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
          legalName: BRAND.legalName,
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
          alternateName: BRAND.en,
          inLanguage: 'zh-CN',
          publisher: { '@id': orgId },
        }}
      />
      {/* 未定价平台：schema 里不放 `offers`（2026-10-03 裁决 4）——`price: '0'` 等于向搜索引擎
          登记一个我们没对外承诺过的价格。代价是 Google 不给这个节点出富结果卡片，
          但实体识别与回答引擎读取不受影响。 */}
      <JsonLd
        value={{
          '@context': 'https://schema.org',
          '@type': 'SoftwareApplication',
          '@id': `${site}/#software`,
          name: BRAND.zh,
          alternateName: BRAND.en,
          url: site,
          description: BRAND.homeDescription,
          applicationCategory: 'MultimediaApplication',
          applicationSubCategory: '视频审片与批注协作',
          operatingSystem: 'Web',
          inLanguage: 'zh-CN',
          keywords: BRAND.keywords.join(', '),
          featureList: [...BRAND_FEATURES],
          image: `${site}/og/brand-1200x630.png`,
          publisher: { '@id': orgId },
        }}
      />
    </>
  )
}
