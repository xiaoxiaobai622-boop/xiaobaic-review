import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export type Section = { heading: string; html: string }
export type MarketingDoc = {
  slug: string; group: 'compare' | 'features'; title: string; description: string
  h1: string; updatedOn: string; sections: Section[]; cta: { href: string; label: string }
  related: string[]; faq: { q: string; a: string }[]; bodyHtml: string
}

const DIR = join(process.cwd(), 'content', 'marketing')
const GROUPS = new Set(['compare', 'features'])
let cache: Map<string, MarketingDoc> | null = null

/* ------------------------------------------------------------------ 前言与校验 */

/** 解析 `---\n{json}\n---\n` 前言。不用 YAML 库：字段全是字符串/数组/对象，JSON.parse 够用且零依赖。 */
function splitFrontmatter(raw: string, file: string): { meta: Record<string, unknown>; body: string; lineOffset: number } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (!m) throw new Error(`${file} 缺少 --- JSON frontmatter 块`)
  let meta: Record<string, unknown>
  try {
    meta = JSON.parse(m[1]) as Record<string, unknown>
  } catch (e) {
    throw new Error(`${file} frontmatter JSON 解析失败：${(e as Error).message}`)
  }
  // 守门报错要落到文件真实行号：正文第 0 行 = 文件的第 lineOffset + 1 行。
  const lineOffset = (m[0].match(/\n/g) ?? []).length
  return { meta, body: raw.slice(m[0].length), lineOffset }
}

/** 按 `## heading` 切正文，顺序与 frontmatter.sections 必须完全一致。 */
function toSections(body: string, expected: string[], file: string): Section[] {
  const parts = body.split(/^## /m).slice(1).map((chunk) => {
    const nl = chunk.search(/\r?\n/)
    const heading = (nl === -1 ? chunk : chunk.slice(0, nl)).trim()
    return { heading, html: nl === -1 ? '' : chunk.slice(nl + 1).trim() }
  })
  const got = parts.map((p) => p.heading)
  if (JSON.stringify(got) !== JSON.stringify(expected)) {
    throw new Error(`${file} 正文小节与 sections 不一致\n  期望: ${expected.join(' | ')}\n  实际: ${got.join(' | ')}`)
  }
  return parts
}

function validate(meta: Record<string, unknown>, file: string): MarketingDoc {
  const req = <K extends string>(k: K) => {
    const v = meta[k]
    if (typeof v !== 'string' || !v.trim()) throw new Error(`${file} 缺字符串字段 ${k}`)
    return v
  }
  // 文件名 `<group>--<slug>.md` 是 URL 的另一半，与前言字段不一致就炸，别让两者各说各话。
  const nameMatch = /^([a-z-]+)--([a-z0-9-]+)\.md$/.exec(file)
  if (!nameMatch) throw new Error(`${file} 文件名不符合 <group>--<slug>.md`)
  const [, expectedGroup, expectedSlug] = nameMatch
  const group = req('group')
  if (!GROUPS.has(group)) throw new Error(`${file} group 必须是 ${[...GROUPS].join('/')}，实际 ${group}`)
  if (group !== expectedGroup) throw new Error(`${file} group「${group}」与文件名前缀「${expectedGroup}」不一致`)
  const slug = meta.slug
  if (typeof slug !== 'string' || !slug.trim()) throw new Error(`${file} 缺字符串字段 slug`)
  if (slug !== expectedSlug) throw new Error(`${file} slug「${slug}」与文件名里的「${expectedSlug}」不一致`)
  const sections = meta.sections
  if (!Array.isArray(sections) || sections.length < 3) throw new Error(`${file} sections 至少 3 条`)
  const cta = meta.cta as { href?: string; label?: string } | undefined
  if (!cta?.href || !cta?.label) throw new Error(`${file} 缺 cta.href 或 cta.label`)
  // 正文链接有 isAllowedHref 把关，CTA 没有——而 CTA 是 `<Link href>` 直接交给路由的（DocPage.tsx:96），
  // `javascript:` 这类值 Next 不拦。前言字段不走 assertSubset（它只管 body），所以这里必须自己拦。
  if (!isAllowedHref(cta.href)) throw new Error(`${file} cta.href 形态不合法（只允许站内根相对路径或 http(s)）：${cta.href}`)
  const related = Array.isArray(meta.related) ? (meta.related as unknown[]) : []
  for (const r of related) {
    if (typeof r !== 'string' || !/^(?:compare|features)\//.test(r)) {
      throw new Error(`${file} related 必须是 compare/... 或 features/... 前缀，实际 ${String(r)}`)
    }
  }
  const faq = meta.faq
  if (!Array.isArray(faq) || faq.length < 3) throw new Error(`${file} faq 至少 3 问`)
  faq.forEach((item, i) => {
    const f = item as { q?: unknown; a?: unknown }
    if (typeof f?.q !== 'string' || !f.q.trim() || typeof f?.a !== 'string' || !f.a.trim()) {
      throw new Error(`${file} faq[${i}] 缺 q 或 a`)
    }
  })
  return {
    group: group as MarketingDoc['group'], slug, title: req('title'),
    description: req('description'), h1: req('h1'), updatedOn: req('updatedOn'),
    sections: [], cta: { href: cta.href, label: cta.label },
    related: related as string[], faq: faq as { q: string; a: string }[], bodyHtml: '',
  }
}

/* ------------------------------------------------------ 子集守门 + 零依赖渲染器 */

/**
 * 子集守门：`.sdd/md-lint.mjs` 在仓库外、CI 看不到，所以 loader 再兜一遍。
 * 命中任何一条就抛错、让页面 500，而不是静默出一版丑排版；报错带文件名与文件行号。
 */
function assertSubset(body: string, lineOffset: number, file: string): void {
  const lines = body.split(/\r?\n/)
  const at = (i: number) => `${file}:${i + lineOffset + 1}`
  lines.forEach((line, i) => {
    if (/^#(?!#)/.test(line)) throw new Error(`${at(i)} 子集守门：一级标题（H1 只来自 frontmatter）`)
    if (/^```/.test(line)) throw new Error(`${at(i)} 子集守门：代码块围栏`)
    if (/^[ \t]*---[ \t]*$/.test(line)) throw new Error(`${at(i)} 子集守门：独占一行的 ---（与 frontmatter 定界符冲突）`)
    if (/<[A-Za-z/!]/.test(line)) throw new Error(`${at(i)} 子集守门：原始 HTML（< 后面紧跟字母、/ 或 !）`)
  })
  lines.forEach((line, i) => {
    if (!/^\|/.test(line)) return
    if (i > 0 && /^\|/.test(lines[i - 1])) return // 只从表块首行起算
    const rows: string[] = []
    for (let j = i; j < lines.length && /^\|/.test(lines[j]); j++) rows.push(lines[j])
    const sep = rows[1]
    if (!sep) throw new Error(`${at(i)} 子集守门：表格缺第二行 |---| 分隔行`)
    const cells = splitRow(sep)
    if (cells.length === 0 || !cells.every((c) => /^:?-{3,}:?$/.test(c))) {
      throw new Error(`${at(i + 1)} 子集守门：表格第二行必须是 |---| 形式（每格 :?-{3,}:?），实际 ${sep}`)
    }
    const widths = rows.map((r) => splitRow(r).length)
    if (new Set(widths).size !== 1) {
      throw new Error(`${at(i)} 子集守门：表格各行列数不一致：${JSON.stringify(widths)}`)
    }
  })
}

/**
 * 安全模型是「构造出来的」：先把整篇 `&`/`<`/`>` 转义，再只按那张子集表生成标签。
 * 文稿里写不进的构造最坏是变成字面文字，不可能变成标记注入，所以除 `innerHTML` 之外
 * 不加任何清洗，也不引 DOMPurify。引号故意不转义：中文文稿里的「」“”要原样进 HTML。
 *
 * 也是 `(marketing)` 里标题类字段的渲染口径：React 的文本节点会把 `"` 转成 `&quot;`，
 * 而契约的 H1 就带直引号（`意见挂在第几帧，不是"大概三分钟"`），所以那些位置共用这个函数。
 */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 表格取格：先剥掉首尾的 `|` 再按 `|` 切，每格 `trim()`。 */
function splitRow(line: string): string[] {
  return line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
}

/** id 不参与 SEO 断言，只要唯一、稳定、不带空格；中文标题要能生成非空 id。 */
function slugify(t: string): string {
  return t.toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-+|-+$/g, '')
}

/** `href` 只允许站内根相对路径或 http(s)；其余一律退化成纯文本，不生成 href。
 *  `//host` 与 `/\host` 必须先挡住：浏览器按协议相对解析到站外，而它们同样 `startsWith('/')`。 */
function isAllowedHref(href: string): boolean {
  if (/^[/\\]/.test(href.slice(1))) return false
  return href.startsWith('/') || /^https?:\/\//.test(href)
}

/** 占位符的边界字符是 U+0000。源码用 String.fromCharCode 而不是字面转义，因为这份文本不能内嵌裸 NUL 字节。 */
const NUL = String.fromCharCode(0)

/**
 * 行内渲染，作用在**已转义**的文本上。三步顺序定死：
 * 1. 先抠 `code`：换成 <code>…</code> 并用「NUL + 序号 + NUL」占位暂存，末尾还原——
 *    这样 code 里的 `[` 与 `**` 不会被后两步误吃。
 */
function inline(text: string): string {
  const stash: string[] = []
  let out = text.replace(/`([^`\n]+)`/g, (_m: string, code: string) => {
    stash.push(`<code>${code}</code>`)
    return NUL + (stash.length - 1) + NUL
  })
  // 2. 再处理 [文本](href)：href 不合规就只输出文本，压根不生成 href。
  out = out.replace(/\[([^\]\n]*)\]\(([^)\n]*)\)/g, (_m: string, label: string, href: string) => {
    const target = href.trim()
    if (!isAllowedHref(target)) return label
    const external = /^https?:\/\//.test(target)
    const quoted = target.replace(/"/g, '&quot;')
    return `<a href="${quoted}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`
  })
  // 3. 最后 **文本** → <strong>文本</strong>；末尾把占位符换回 <code>。
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  return out.replace(new RegExp(`${NUL}(\\d+)${NUL}`, 'g'), (_m: string, n: string) => stash[Number(n)] ?? '')
}

/** 块级：按行扫，空行断块。只认那张子集表里的六种起始形态，其余连续非空行合并成 <p>。 */
function renderBlocks(body: string): string {
  const lines = body.split(/\r?\n/)
  const out: string[] = []
  const isBlank = (l: string) => l.trim() === ''
  const startsBlock = (l: string) =>
    /^## /.test(l) || /^### /.test(l) || /^>/.test(l) || /^- /.test(l) || /^\d+\. /.test(l) || /^\|/.test(l)
  const run = (from: number, test: (l: string) => boolean): [string[], number] => {
    const collected: string[] = []
    let i = from
    while (i < lines.length && test(lines[i])) collected.push(lines[i++])
    return [collected, i]
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line)) { i++; continue }
    if (/^## /.test(line)) {
      const text = line.slice(3).trim()
      out.push(`<h2 id="${slugify(text)}">${inline(escapeHtml(text))}</h2>`)
      i++
      continue
    }
    if (/^### /.test(line)) {
      out.push(`<h3>${inline(escapeHtml(line.slice(4).trim()))}</h3>`)
      i++
      continue
    }
    if (/^>/.test(line)) {
      const [rows, next] = run(i, (l) => /^>/.test(l))
      const text = rows.map((l) => l.replace(/^>\s?/, '')).join('\n')
      out.push(`<blockquote><p>${inline(escapeHtml(text))}</p></blockquote>`)
      i = next
      continue
    }
    if (/^- /.test(line)) {
      const [rows, next] = run(i, (l) => /^- /.test(l))
      out.push(`<ul>${rows.map((l) => `<li>${inline(escapeHtml(l.slice(2).trim()))}</li>`).join('')}</ul>`)
      i = next
      continue
    }
    if (/^\d+\. /.test(line)) {
      const [rows, next] = run(i, (l) => /^\d+\. /.test(l))
      out.push(`<ol>${rows.map((l) => `<li>${inline(escapeHtml(l.replace(/^\d+\.\s+/, '').trim()))}</li>`).join('')}</ol>`)
      i = next
      continue
    }
    if (/^\|/.test(line)) {
      const [rows, next] = run(i, (l) => /^\|/.test(l))
      const cells = rows.map(splitRow)
      const [head, , ...rest] = cells // 第一行 th，第二行是分隔行、丢弃，其余 td
      const tr = (tag: string, row: string[]) => `<tr>${row.map((c) => `<${tag}>${inline(escapeHtml(c))}</${tag}>`).join('')}</tr>`
      out.push(`<table><thead>${tr('th', head)}</thead><tbody>${rest.map((r) => tr('td', r)).join('')}</tbody></table>`)
      i = next
      continue
    }
    const [rows, next] = run(i, (l) => !isBlank(l) && !startsBlock(l))
    out.push(`<p>${inline(escapeHtml(rows.join('\n')))}</p>`)
    i = next
  }
  return out.join('\n')
}

/* ----------------------------------------------------------------------- 装配 */

/** 同步：解析 + 校验 + 渲染一篇。计划里的 async 版本是为了 `await import('marked')`，现在不需要。 */
function parseDoc(file: string): MarketingDoc {
  const raw = readFileSync(join(DIR, file), 'utf8')
  const { meta, body, lineOffset } = splitFrontmatter(raw, file)
  const doc = validate(meta, file)
  assertSubset(body, lineOffset, file)
  doc.sections = toSections(body, meta.sections as string[], file)
  doc.bodyHtml = renderBlocks(body)
  return doc
}

/** key = `${group}/${slug}`。进程内缓存：根 layout 的 `force-dynamic` 让每请求都跑到这里，
 *  没有这层缓存每请求都要重读重解析六个文件。dev 下改完 `.md` 要重启进程才生效，这是缓存在进程内的代价。 */
export function loadDocs(): Map<string, MarketingDoc> {
  if (cache) return cache
  const map = new Map<string, MarketingDoc>()
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.md')).sort()) {
    const doc = parseDoc(file)
    map.set(`${doc.group}/${doc.slug}`, doc)
  }
  cache = map
  return map
}

export function getDoc(group: string, slug: string): MarketingDoc | null {
  return loadDocs().get(`${group}/${slug}`) ?? null
}
