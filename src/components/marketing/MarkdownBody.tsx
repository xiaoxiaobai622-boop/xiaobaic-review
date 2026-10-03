// 正文 HTML 由 `src/lib/marketing/content.ts` 的子集渲染器构造（先整篇转义 &<>，再只按子集生成
// 标签），不是任何用户输入，所以这里直接注入，不再走第二遍清洗。
export function MarkdownBody({ html }: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />
}
