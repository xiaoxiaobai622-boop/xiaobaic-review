/**
 * 判据：首页媒体不许再往镜像里塞死重，也不许用 1080p/1.5Mbps 的背景片直出容器。
 *
 * 起因（10-08 实测）：`public/` 8.6MB 里 4 枚 mp4 共 5.6MB，只有 `hero.mp4` 真在首页用；
 * `review.mp4`／`editing.mp4` 全仓零引用，`film-set.mp4` 只是 `scripts/build-home-demo.mts`
 * 造演示素材的兜底原料 —— 三枚 3.2MB 每次部署都进镜像、从来不被服务。
 * 同时 `hero.mp4` 是 1920×1080 / 13 秒 / 1.497 Mbps 的 `<video muted loop>` 背景，
 * 首屏一次访问就直出 2.4MB，而它是背景不是内容。
 *
 * 全部静态：只读文件字节与 MP4 box 头，零凭据、零网络、零 ffprobe ⇒ 可进 CI（`npm run check:static`）。
 *
 * 跑法：npx tsx scripts/check-home-media-budget.mts
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const KB = 1024

let pass = 0
let fail = 0
function check(ok: boolean, name: string, evidence: string) {
  if (ok) { pass++; console.log(`  PASS  ${name}  ${evidence}`) }
  else { fail++; console.log(`  FAIL  ${name}  ${evidence}`) }
}

function bytes(rel: string): number {
  try { return fs.statSync(path.join(ROOT, rel)).size } catch { return -1 }
}

/**
 * MP4 顶层 box 顺序（faststart 的判据就是 moov 在 mdat 之前）。
 * box 头 = 4 字节大端长度 + 4 字节类型；长度 1 表示后面跟 8 字节 largesize，0 表示到文件尾。
 */
function boxOrder(file: string): string[] {
  const buf = fs.readFileSync(path.join(ROOT, file))
  const order: string[] = []
  let offset = 0
  while (offset + 8 <= buf.length) {
    let size = buf.readUInt32BE(offset)
    const type = buf.toString('latin1', offset + 4, offset + 8)
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(offset + 8))
    } else if (size === 0) {
      size = buf.length - offset
    }
    if (size < 8) break
    order.push(type)
    offset += size
  }
  return order
}

/** 列出 src/ 下所有会被打进镜像的源码文本，用来判「public 里这枚文件真的有人引用」。 */
function srcBlob(): string {
  const walk = (dir: string, out: string[]) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name)
      if (entry.isDirectory()) { if (!entry.name.startsWith('.')) walk(rel, out) }
      else if (/\.(ts|tsx|js|jsx|css|mjs)$/.test(entry.name)) out.push(rel)
    }
    return out
  }
  return walk('src', []).map(rel => fs.readFileSync(rel, 'utf8')).join('\n')
}

const heroPath = 'public/home/hero.mp4'
const posterPath = 'public/home/hero-poster.jpg'
/**
 * 上限不是拍脑袋：10-08 定档 1600×900/CRF32 实测 1,202,719 B，这里留 4% 余量
 * （同一档重录不该变红，回到原来那枚 1920×1080 的 2,433,089 B 必须变红）。
 * 分辨率下限（≥1540＝实测渲染宽 770 CSS px × 2）住在 check-home-redesign.mts 的 H36·c/H38·b，
 * 那两条要 ffprobe 与真浏览器，不在这里重复一遍。
 */
const HERO_MAX_BYTES = 1_250_000
const POSTER_MAX_BYTES = 150 * 1024

console.log('=== 首屏直出的字节上限 ===')
const heroBytes = bytes(heroPath)
check(heroBytes > 0 && heroBytes <= HERO_MAX_BYTES,
  'M1 hero.mp4 ≤ 1.25MB（它是产品录屏背景，不是内容）',
  heroBytes < 0 ? '文件不存在' : `${(heroBytes / KB).toFixed(0)} KB / 上限 ${(HERO_MAX_BYTES / KB).toFixed(0)} KB`)
const posterBytes = bytes(posterPath)
check(posterBytes > 0 && posterBytes <= POSTER_MAX_BYTES,
  'M2 首屏海报 ≤ 150KB（视频没起来时用户看到的就是它）',
  posterBytes < 0 ? '文件不存在' : `${(posterBytes / KB).toFixed(0)} KB / 上限 ${(POSTER_MAX_BYTES / KB).toFixed(0)} KB`)

console.log('=== 流式播放的前置条件 ===')
const boxes = bytes(heroPath) > 0 ? boxOrder(heroPath) : []
const iMoov = boxes.indexOf('moov')
const iMdat = boxes.indexOf('mdat')
check(iMoov > -1 && iMdat > -1 && iMoov < iMdat,
  'M3 hero.mp4 是 faststart（moov 在 mdat 之前，否则要下完才开播）',
  `顶层 box 顺序 ${boxes.slice(0, 6).join('→') || '(解析不出)'}`)

console.log('=== public 里不许有没人引用的媒体 ===')
const allSrc = srcBlob()
const orphans = fs.readdirSync(path.join(ROOT, 'public/home'))
  .filter(name => /\.(mp4|webm|mov|png|jpg|jpeg|webp|avif)$/i.test(name))
  .filter(name => !allSrc.includes(name))
check(orphans.length === 0,
  'M4 public/home 每枚媒体都被 src/ 引用（public 整个进镜像并随线上发布）',
  orphans.length ? `零引用：${orphans.join(' ')}` : '全部有引用')

console.log('=== 演示原料住在 scripts，不住在 public ===')
check(bytes('scripts/fixtures/film-set.mp4') > 0,
  'M5 兜底原料在 scripts/fixtures/（build-home-demo 的 SOURCE_CLIP）', `scripts/fixtures/film-set.mp4 ${(bytes('scripts/fixtures/film-set.mp4') / KB).toFixed(0)} KB`)
check(bytes('public/home/film-set.mp4') === -1,
  'M6 这枚原料不再随镜像发布', 'public/home/film-set.mp4 应不存在')
check(/SOURCE_CLIP\s*=\s*'scripts\/fixtures\/film-set\.mp4'/.test(fs.readFileSync('scripts/build-home-demo.mts', 'utf8')),
  'M7 脚本读的正是新位置（文件挪了路径没改＝脚本一跑就抛）', 'SOURCE_CLIP = scripts/fixtures/film-set.mp4')

console.log(`\n合计 ${pass} PASS / ${fail} FAIL`)
process.exit(fail === 0 ? 0 : 1)
