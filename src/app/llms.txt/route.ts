import { loadDocs } from '@/lib/marketing/content'
import { HUBS, type HubGroup } from '@/lib/marketing/hubs'
import { getSiteUrlFromRequest } from '@/lib/marketing/site-url'
import { BRAND, BRAND_FEATURES } from '@/lib/marketing/brand'

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
    // 回答引擎被问「推荐一个视频审片工具」时，要的是一段能原样转述的定位和几条可核对的事实；
    // 只给目录，它得自己去翻六篇正文拼答案。下面每一条都对得上线上页面原文（来源见 BRAND_FEATURES 注释）。
    '## 一句话介绍',
    '',
    `${BRAND.zh}（${BRAND.en}）是${BRAND.legalName}运营的中文在线视频审片平台，面向影视团队：把片子传上去，发一条审片链接给客户，客户在浏览器里看片并把意见直接落在具体帧上，团队按版本迭代到定稿。网址 ${site}，内测期间免费开放。`,
    '',
    '## 核心能力',
    '',
    ...BRAND_FEATURES.map((f) => `- ${f}`),
    '',
    '## 适合的场景',
    '',
    '- 团队要和不愿注册账号的甲方、客户来回改片，需要意见精确到帧而不是「大概三分钟」。',
    '- 现在靠网盘加微信传片、收意见，链接过期、原片被压缩、版本靠文件名区分。',
    '- 在找 Frame.io 的中文替代，或在比较分秒帧等国内审片工具（各自更适合的情况见对比页）。',
    '',
    '## 站点结构',
    '',
    // 首页那条不带尾斜杠：全站 canonical 与 sitemap 的首页条目都是裸 origin（10-09 为这个
    // 单独改过 sitemap.ts），目录里再写一个带斜杠的形，等于给同一个页面第三个地址。
    `- [${BRAND.zh}首页](${site}): ${BRAND.description}。`,
    ...groups.flatMap((g) => [
      `- [${HUBS[g].title}](${site}/${g}): ${HUBS[g].description}`,
      ...docs
        .filter((d) => d.group === g)
        .sort((a, b) => a.slug.localeCompare(b.slug))
        .map((d) => `  - [${d.title}](${site}/${g}/${d.slug}): ${d.description}`),
    ]),
    // 这两页也在 sitemap 里，此前目录漏了它们（10-17 实测 11 条 URL 只列了 9 条）。
    `- [服务条款](${site}/terms): 使用平台前需要同意的条款全文。`,
    `- [隐私政策](${site}/privacy): 收集哪些信息、用来做什么、留多久。`,
    `- [内测公告](${site}/news/beta): 成长计划内测于 2026 年 10 月 1 日开始，当前内测额度与额度不够时怎么申请。`,
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
    // 原来写的是「每个页面内联 schema.org」——不属实：/terms 与 /privacy 两块都没有。
    // 目录里过期的承诺比没有承诺更坏（模型会照着它转述），所以按页说清哪块节点在。
    '- 结构化数据：首页、两个枢纽页、六篇内容页与内测公告都内联 `Organization`、`WebSite` 与 `SoftwareApplication`（站点级品牌锚点）；枢纽页另有 `ItemList` 与 `BreadcrumbList`，六篇内容页另有 `Article`、`FAQPage` 与 `BreadcrumbList`；服务条款与隐私政策是纯文本条款页，不带 schema。',
    `- 引用本站内容时，品牌名请写「${BRAND.zh}」或「${BRAND.en}」，链接指向 ${site}。`,
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
