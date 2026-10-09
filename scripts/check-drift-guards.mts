/**
 * 判据：10-08 漂移台账里「同一份东西有多条出口/多份拷贝，其中一条没跟着改」这一类，
 * 逐条钉住。全部是静态读文件，零凭据、零网络、零数据库 ⇒ 可以进 CI 的 verify（台账 12）。
 *
 * 类别定义取自 c7c8311：写走存储抽象（S3 模式落对象存储），读/删/失效却用裸 fs 只认容器本地盘；
 * 或同一资源的多条出口里有一条没跟着改（文件名、域名、缓存键、链接形状、套餐数字、语言包 key）。
 *
 * 跑法：npx tsx scripts/check-drift-guards.mts
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

let pass = 0
let fail = 0
function check(ok: boolean, name: string, evidence: string) {
  if (ok) { pass++; console.log(`  PASS  ${name}  ${evidence}`) }
  else { fail++; console.log(`  FAIL  ${name}  ${evidence}`) }
}

/** 递归列出 src 下的源码文件（跳过 Next 生成物与已停用计费目录之外的噪音）。 */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      sourceFiles(rel, out)
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
      out.push(rel)
    }
  }
  return out
}

const allSrc = sourceFiles('src')

// ── 台账 1 的类别本体：裸 fs 读存储必须配一条 S3 分支 ─────────────────────────
console.log('=== ① 读存储抽象不许有裸 fs 的漏网出口 ===')
const fsOnlyReaders = allSrc.filter(rel => {
  const src = read(rel)
  return /(?<![.\w])getFilePath\(/.test(src) && !src.includes('isS3Mode')
})
check(fsOnlyReaders.length === 0,
  'D1 凡是用 getFilePath 的文件都同时认得 isS3Mode',
  fsOnlyReaders.length ? `漏网：${fsOnlyReaders.join(' ')}` : `${allSrc.filter(r => read(r).includes('getFilePath(')).length} 个文件全部有分支`)
check(read('src/lib/storage.ts').includes('export async function getStoredFileSize'),
  'D2 storage.ts 提供 getStoredFileSize（问对象存储要字节数，代替 fs.statSync）', 'export async function getStoredFileSize')

// ── 台账 2：分享图基址 ───────────────────────────────────────────────────────
console.log('=== ② 分享图不许再是相对路径 / localhost 兜底 ===')
check(read('src/app/page.tsx').includes('metadataBase'),
  'D3 首页 metadata 自带 metadataBase（根 layout 没有，相对 og:image 会被拼成 localhost）', 'metadataBase')
check(read('src/app/(marketing)/layout.tsx').includes('metadataBase'),
  'D4 营销 layout 的 metadataBase 也还在（首页与内容页是两条出口，10-08 只有它有）', 'metadataBase')
// 静态脚本证不了"渲染出来的 og:image 是绝对址"——那一条在 scripts/seo-check.mjs 里，
// 它打真页面并断 og:image 与 canonical 同源。这里只钉住两个必需的源头。

// ── 台账 3：PWA manifest 的每条 URL 都要有对应路由 ────────────────────────────
console.log('=== ③ manifest 里每条 URL 都得真有这一页 ===')
const pages = allSrc
  .filter(rel => /\/page\.(tsx|ts|jsx|js)$/.test(rel))
  .map(rel => '/' + path.dirname(rel).replace(/^src\/app\/?/, '').split('/')
    .filter(seg => !seg.startsWith('(')).join('/'))
  .map(url => url.replace(/\/{2,}/g, '/'))
const routeSet = new Set(pages)
function pageExists(url: string): boolean {
  const clean = url.split('?')[0].replace(/\/$/, '') || '/'
  if (routeSet.has(clean)) return true
  // 动态段兜底：只有当那条路由还有至少一段是写死的名字时才算「这一页存在」。
  // 纯通配的根级路由 `/[shareCode]` 会接住 /admin，但它接着是为了回 404，不是有一页。
  return pages.some(pattern => {
    const segs = pattern.split('/').filter(Boolean)
    if (!segs.some(s => !s.startsWith('['))) return false
    return new RegExp(`^${pattern.replace(/\[[^\]]+\]/g, '[^/]+')}$`).test(clean)
  })
}
const manifestRaw = read('public/manifest.json')
const manifest = JSON.parse(manifestRaw)
const manifestUrls: string[] = [manifest.start_url, ...(manifest.shortcuts || []).map((s: any) => s.url)].filter(Boolean)
check(manifestUrls.every(pageExists),
  'D5 start_url 与全部 shortcuts 都落在真实路由上',
  manifestUrls.map(u => `${u}${pageExists(u) ? ' ✓' : ' ✗'}`).join(' '))
check(!/\/admin\b/.test(manifestRaw),
  'D6 manifest 不再指向仓库里根本不存在的 /admin', 'admin 出现 0 次')

// ── 台账 4：半途 TUS 分片 ────────────────────────────────────────────────────
console.log('=== ④ TUS 临时目录：写方与清方必须同一枚、且必须在共享卷里 ===')
const storageLib = read('src/lib/storage.ts')
check(/export const TUS_TMP_DIR = path\.join\(STORAGE_ROOT/.test(storageLib),
  'D7 TUS 临时目录由 STORAGE_ROOT 派生（/app/uploads 是 app 与 worker 唯一共享的卷）', 'path.join(STORAGE_ROOT')
const tusLiterals = allSrc.filter(rel => /['"]\/tmp\/vitransfer-tus-uploads/.test(read(rel)))
check(tusLiterals.length === 0,
  'D8 全仓不再有第二处硬编码的分片目录', tusLiterals.join(' ') || '0 处')
const writer = read('src/pages/api/uploads/[[...path]].ts')
const cleaner = read('src/lib/upload-cleanup.ts')
check(writer.includes('TUS_TMP_DIR') && cleaner.includes('TUS_TMP_DIR')
  && writer.includes("from '@/lib/storage'") && cleaner.includes("from './storage'"),
  'D9 写方（app 容器）与清方（worker 容器）都从 storage 引同一枚常量', '两边都 import TUS_TMP_DIR')
const compose = read('docker-compose.yml')
const workerService = /worker:[\s\S]*?volumes:([\s\S]*?)\n\s*networks:/.exec(compose)?.[1] ?? ''
const appService = /app:[\s\S]*?volumes:([\s\S]*?)\n\s*networks:/.exec(compose)?.[1] ?? ''
check(appService.includes('uploads:/app/uploads') && workerService.includes('uploads:/app/uploads'),
  'D10 app 与 worker 两个服务都挂同一个 uploads 卷（否则清方看不见写方的文件）',
  `app=${appService.trim().split('\n').length}行 worker=${workerService.trim().split('\n').length}行`)

// ── 台账 5：飞书标题的旧品牌 ─────────────────────────────────────────────────
console.log('=== ⑤ 用户可见文案里不许留旧品牌名 ===')
const feishu = read('src/lib/feishu.ts')
check(!/MLE6/.test(feishu), 'D11 飞书推送不再写 MLE6', 'MLE6 应 0 次')
check(/title:\s*`🎬 \$\{BRAND\.zh\}/.test(feishu) && feishu.includes("from './marketing/brand'"),
  'D12 标题取自共享的品牌常量', '`🎬 ${BRAND.zh}')

// ── 台账 7：席位进度条的分母 ────────────────────────────────────────────────
console.log('=== ⑦ 席位上限只能来自服务端套餐 ===')
const membersPage = read('src/app/studio/team/members/page.tsx')
check(!/activeMembers\.length\s*\/\s*10\b/.test(membersPage),
  'D13 没有再写死 / 10 当分母', '写死分母应 0 次')
check(/useState<number \| null>\(null\)/.test(membersPage) && membersPage.includes('maxMembers'),
  'D14 分母来自 overview 接口的 quota.maxMembers', 'seatCap ← quota.maxMembers')

// ── 台账 9：四语言 key 必须齐平 ─────────────────────────────────────────────
console.log('=== ⑨ 四语言 key 集合完全对齐 ===')
const keySets = new Map<string, Set<string>>()
for (const loc of ['zh', 'en', 'de', 'nl']) {
  const walk = (o: any, prefix: string, into: Set<string>) => {
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === 'object') walk(v, `${prefix}${k}.`, into)
      else into.add(`${prefix}${k}`)
    }
  }
  const set = new Set<string>()
  walk(JSON.parse(read(`src/locales/${loc}.json`)), '', set)
  keySets.set(loc, set)
}
const base = keySets.get('zh')!
for (const loc of ['en', 'de', 'nl']) {
  const set = keySets.get(loc)!
  const missing = [...base].filter(k => !set.has(k))
  const extra = [...set].filter(k => !base.has(k))
  check(missing.length === 0 && extra.length === 0,
    `D15 ${loc} 与 zh 的 key 集合齐平`,
    `${set.size} 枚${missing.length ? `，缺 ${missing.slice(0, 6).join('/')}${missing.length > 6 ? '…' : ''}` : ''}${extra.length ? `，多 ${extra.slice(0, 6).join('/')}` : ''}`)
}
// 曾经整批缺席的那族批量操作 key，逐枚点出来作证据（不只是"总数对上了"）
const batchKeys = ['batchManage', 'batchApprove', 'batchArchive', 'archivedSection']
for (const key of batchKeys) {
  const hit = ['zh', 'en', 'de', 'nl'].filter(l => [...keySets.get(l)!].some(k => k.endsWith(`.${key}`)))
  check(hit.length === 4, `D16「${key}」四语言都有`, hit.join('/') || '全缺')
}

// ── 台账 10：S3 模式下的幂等短路 ────────────────────────────────────────────
console.log('=== ⑩ 上传收尾的幂等检查不许只认本地盘 ===')
const idempotencyStart = writer.indexOf('async function ensureTusFileStored')
const idempotencyEnd = writer.indexOf('async function verifyUploadedFile')
// 注释里写着「used to be fs.existsSync(...)」正是这段的历史，判据要扫的是代码不是说明。
const codeOnly = (s: string) => s.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')
const idempotency = codeOnly(writer.slice(idempotencyStart, idempotencyEnd > -1 ? idempotencyEnd : undefined))
check(idempotencyStart > -1 && idempotency.includes('getStoredFileSize('),
  'D17 幂等短路问存储抽象要字节数', 'getStoredFileSize(finalStoragePath)')
check(idempotency.length > 0 && !/fs\.existsSync\(/.test(idempotency),
  'D18 那一段里没有 fs.existsSync（S3 下永假 ⇒ 重试永久失败）', `函数体代码 ${idempotency.length} 字节内 0 次`)

// ── 台账 11：worker 写的状态值必须都在 schema 注释里 ─────────────────────────
console.log('=== ⑪ worker 写的 transcodeStatus 字面量 ⊆ schema 注释声明的取值 ===')
const schema = read('prisma/schema.prisma')
const contractLine = schema.split('\n').find(l => l.includes('transcodeStatus') && l.includes('//')) ?? ''
const declared = new Set((contractLine.match(/\/\/\s*([A-Z, ]+)/)?.[1] ?? '').split(',').map(s => s.trim()).filter(Boolean))
const workerFiles = sourceFiles('src/worker')
const used = new Set<string>()
for (const rel of workerFiles) for (const m of read(rel).matchAll(/transcodeStatus:\s*'([A-Z_]+)'/g)) used.add(m[1])
const undeclared = [...used].filter(v => !declared.has(v))
check(declared.size >= 3 && used.size >= 2 && undeclared.length === 0,
  'D19 注释列出的取值覆盖 worker 实际写入的每一枚',
  `声明 ${[...declared].join('/')} ↔ worker 用 ${[...used].join('/')}${undeclared.length ? ` ⚠ 未声明：${undeclared.join('/')}` : ''}`)
check(read('tsconfig.json').includes('src/worker'),
  'D20 承认这是盲区：tsconfig 排除 src/worker，所以 tsc/build 听不到这层（注释才是契约）', 'exclude 含 src/worker')

// ── 台账 12：闸门本身 ───────────────────────────────────────────────────────
console.log('=== ⑫ CI 的 verify 里真的跑静态判据 ===')
const workflow = read('.github/workflows/xiaobaic-ci-deploy.yml')
const pkg = JSON.parse(read('package.json'))
const STATIC_CHECKS = [
  'check-drift-guards.mts',
  'check-branding-read-paths.mts',
  'check-dual-video-sync.mts',
  'check-team-writeable.mts',
  'check-home-media-budget.mts',
]
const staticEntry: string = pkg?.scripts?.['check:static'] ?? ''
check(STATIC_CHECKS.every(s => staticEntry.includes(s)),
  'D21 package.json 的 check:static 收齐四枚静态判据',
  staticEntry ? `缺 ${STATIC_CHECKS.filter(s => !staticEntry.includes(s)).join(' ') || '无'}` : '没有 check:static 这一条')
const verifyJob = workflow.split('\njobs:\n')[1]?.split('\n  image:')?.[0] ?? ''
check(verifyJob.includes('npm run check:static'),
  'D22 verify 作业调用了 check:static（10-08 之前这里只有 npm ci / audit / build）',
  `verify 段 ${verifyJob.length} 字节`)
// 只看真正会执行的 `run:` 那一行——注释里提到文件名是说明，不是引用。
const runLines = (workflow.match(/^\s*run:\s*(.*)$/gm) ?? []).join('\n')
check(!/check-phone-field/.test(runLines),
  'D23 会写库的判据没被塞进 CI（check-phone-field 会建/删审计行）', `run 行 ${runLines.split('\n').length} 条内 0 次`)

// ── ⑬ 静态资源换域名：assetPrefix 与 CSP 必须是同一枚构建期来源 ───────────────
console.log('=== 静态资源走 CDN 时，CSP 不许把自家脚本拦死 ===')
const nextConfig = read('next.config.js')
const proxySrc = read('src/proxy.ts')
// 值只有一个来源：构建期 ASSET_PREFIX → assetPrefix 与 env.BUILD_ASSET_PREFIX 都吃它。
const prefixConst = /const\s+ASSET_PREFIX\s*=/.test(nextConfig)
check(prefixConst && /assetPrefix:\s*ASSET_PREFIX\s*\|\|\s*undefined/.test(nextConfig),
  'C1 next.config 的 assetPrefix 只认构建期常量（空＝行为一字不变）',
  prefixConst ? 'const ASSET_PREFIX → assetPrefix' : '没找到单一来源')
check(/BUILD_ASSET_PREFIX:\s*ASSET_PREFIX/.test(nextConfig),
  'C2 同一枚值以 BUILD_ASSET_PREFIX 内联进产物（运行期容器里没有 ASSET_PREFIX）',
  'env.BUILD_ASSET_PREFIX = ASSET_PREFIX')
// CSP 读的是内联那枚，不是运行期 env —— 读错的那一次是静默白屏，不是报错。
check(proxySrc.includes("process.env.BUILD_ASSET_PREFIX"),
  'C3 CSP 取构建期内联的那枚（runner 容器没配运行期 env，读 ASSET_PREFIX 会永远为空）',
  'process.env.BUILD_ASSET_PREFIX')
check(!/process\.env\.ASSET_PREFIX\b(?!_)/.test(proxySrc.replace(/BUILD_ASSET_PREFIX/g, '@')),
  'C4 proxy.ts 里没有第二枚取值口径', 'ASSET_PREFIX 直读 0 次')
// 挪出去的静态资源有四类（脚本/样式/图片/字体），漏一条就是白屏、无样式或缺字。
// `script-src-attr` 那一条不算（它管的是内联事件属性，静态资源不走它）。
const assetVar = /(?:let|const)\s+(\w*[Aa]sset\w*Origin)\s*=/.exec(proxySrc)?.[1] ?? ''
const cspLines = proxySrc.split('\n').filter(l => /^\s*[`"'](script-src|style-src|img-src|font-src)[\s'"]/.test(l.trim()))
check(cspLines.length === 4, 'C5a 四条资源指令都被扫到（少一条＝判据自己瞎了）', `${cspLines.length} 条`)
check(Boolean(assetVar) && cspLines.every(l => l.includes(assetVar)),
  'C5 script-src／style-src／img-src／font-src 四条都拼上这枚 origin',
  assetVar ? `变量 ${assetVar}，命中 ${cspLines.filter(l => l.includes(assetVar)).length}/${cspLines.length} 条` : '没找到那枚变量')

console.log(`\n合计 ${pass} PASS / ${fail} FAIL`)
process.exit(fail === 0 ? 0 : 1)
