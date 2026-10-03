import { headers } from 'next/headers'

/**
 * `src/proxy.ts:84,103` 是 nonce 制 CSP（`script-src 'self' 'nonce-…'`），
 * 内联脚本不带 nonce 会被浏览器拒执行，所以这个组件必须是 async 且从 headers 取 nonce。
 */
export async function JsonLd({ value }: { value: Record<string, unknown> }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined
  // `<` 必须转义：正文有 `assertSubset` 守门，frontmatter 的 title/description/faq 没有。
  // 一个 `</script>` 就会让图谱提前闭合、后面的文案变成解析器眼里的真标记。`\u003c` 不改 JSON 语义。
  const safeJson = JSON.stringify(value).replace(/</g, '\\u003c')
  return <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: safeJson }} />
}
