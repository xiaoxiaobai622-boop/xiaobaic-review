import { loadDocs } from '@/lib/marketing/content'
import { HUBS, type HubGroup } from '@/lib/marketing/hubs'
import { getSiteUrlFromRequest } from '@/lib/marketing/site-url'
import { BRAND } from '@/lib/marketing/brand'

export const dynamic = 'force-dynamic'

/**
 * `llms.txt`（https://llmstxt.org）是给大模型抓取器看的站点目录：一段纯文本，说清这个站是谁、
 * 有哪些页面、每页回答什么问题。这里整份从六篇文稿的 frontmatter 生成，不另抄一份——
 * 手抄的那份改稿时一定过期，而过期的目录比没有目录更坏（模型会拿到旧口径）。
 *
 * 目录名叫 `llms.txt`（带点）是字面量静态段，优先级高于根级动态段 `src/app/[shareCode]/page.tsx`，
 * 和 `/login`、`/features` 同一套匹配规则。
 */
export async function GET() {
  const site = await getSiteUrlFromRequest()
  const docs = [...loadDocs().values()]
  const groups: HubGroup[] = ['features', 'compare']
  const latest = docs.map((d) => d.updatedOn).sort().at(-1) ?? ''

  const lines: string[] = [
    `# ${BRAND.zh}（${BRAND.en}）`,
    '',
    `> ${BRAND.description}。发一条带密码和有效期的链接给客户，对方不注册就能看片、按时间码写意见。`,
    '',
    '## 站点结构',
    '',
    `- [${BRAND.zh}首页](${site}/): ${BRAND.description}。`,
    ...groups.flatMap((g) => [
      `- [${HUBS[g].title}](${site}/${g}): ${HUBS[g].description}`,
      ...docs
        .filter((d) => d.group === g)
        .sort((a, b) => a.slug.localeCompare(b.slug))
        .map((d) => `  - [${d.title}](${site}/${g}/${d.slug}): ${d.description}`),
    ]),
    '',
    '## 各页回答的问题',
    '',
    '下面这些问句逐字出现在对应页面的 FAQ 小节里，答案就在那一页。',
    '',
    ...groups.flatMap((g) => [
      `### ${HUBS[g].title}`,
      ...docs
        .filter((d) => d.group === g)
        .sort((a, b) => a.slug.localeCompare(b.slug))
        .flatMap((d) => [
          `- ${d.title}（${site}/${g}/${d.slug}）`,
          ...d.faq.map((f) => `  - ${f.q}`),
        ]),
      '',
    ]),
    '## 关于这份目录',
    '',
    `- 页面标题：${BRAND.zh}（英文名 ${BRAND.en}）；界面与内容语言为中文（zh-CN）。`,
    '- 每个页面内联 schema.org 结构化数据：站点级 `Organization` 与 `WebSite`，内容页另有 `Article` 与 `FAQPage`，枢纽页另有 `SoftwareApplication` 与 `BreadcrumbList`。',
    `- 全部可索引页面的清单：${site}/sitemap.xml；抓取规则：${site}/robots.txt。`,
    `- 内容页文稿最后核对于 ${latest}。`,
    '',
  ]

  return new Response(lines.join('\n'), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  })
}
