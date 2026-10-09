/**
 * 判据：品牌图的「读」必须跟着「写」走同一套存储抽象，而且名字只能有一个出处。
 *
 * 起因（10-07）：线上是 S3/COS 模式，`POST /api/settings/logo` 用 uploadFile 写进对象存储，
 * 而 `GET /api/branding/logo` 与邮件用的 `GET /api/branding/logo-png` 只 `fs.readFile(getFilePath(...))`
 * 读容器本地盘 ⇒ 他每次换自定义标志都"回去了"（读到的是镜像里那份旧文件）。
 * 同一页的 favicon 之所以能换成功，是因为 `/api/branding/favicon` 两条分支都写了。
 *
 * 追加（10-08 漂移台账 1、8）：PNG 缓存当初也是「读写走本地盘、失效走 deleteFile」，
 * 而两个失效器还在枚举早已退役的 `default-logo-${accent}.png`；key 名字散在四份文件里
 * 各自拼字符串，改一处就把其余三处留在原地。所以这里既查「读没走抽象」，也查「名字有没有第二个出处」。
 *
 * 跑法：npx tsx scripts/check-branding-read-paths.mts
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

const logoGet = read('src/app/api/branding/logo/route.ts')
const logoPng = read('src/app/api/branding/logo-png/route.ts')
const logoUpload = read('src/app/api/settings/logo/route.ts')
const faviconGet = read('src/app/api/branding/favicon/route.ts')
const settingsRoute = read('src/app/api/settings/route.ts')
const brand = read('src/lib/brand.ts')

const SOURCE_KEY = brand.match(/LOGO_SOURCE_KEY\s*=\s*'([^']+)'/)?.[1] ?? ''
const PNG_KEY = brand.match(/LOGO_PNG_KEY\s*=\s*'([^']+)'/)?.[1] ?? ''

console.log('=== 读端要分两条路（S3 / 本地）===')
check(logoGet.includes('isS3Mode('), 'B1 标志 GET 有 S3 分支', 'isS3Mode(')
check(logoGet.includes('s3FileExists(') && logoGet.includes('s3GetPresignedDownloadUrl('),
  'B2 标志 GET 的 S3 分支照 favicon 那套探在不在、再 302 到预签名地址', 's3FileExists + s3GetPresignedDownloadUrl')
check(/status:\s*302|,\s*302\s*\)/.test(logoGet) || logoGet.includes('redirect('),
  'B3 标志 GET 会 302（不把字节代理过 Node）', 'redirect/302')

console.log('=== key 只有一个出处（@/lib/brand），四份文件都引用它 ===')
check(!!SOURCE_KEY && !!PNG_KEY,
  'B4 brand.ts 里两枚 key 都在', `source=${SOURCE_KEY || '(缺)'} png=${PNG_KEY || '(缺)'}`)
const KEY_FILES: Array<[string, string]> = [
  ['标志 GET', logoGet],
  ['邮件 PNG', logoPng],
  ['上传/删除端', logoUpload],
]
for (const [label, src] of KEY_FILES) {
  check(src.includes('LOGO_SOURCE_KEY') && src.includes("@/lib/brand"),
    `B5 ${label} 从 @/lib/brand 引常量`, `${label} ↔ LOGO_SOURCE_KEY`)
  // 自己再拼一遍字面量＝第二个出处：改名时这一处会留在原地（10-08 台账 8 的机制）
  const respelled = [`'${SOURCE_KEY}'`, `'${PNG_KEY}'`].filter(lit => src.includes(lit))
  check(respelled.length === 0,
    `B6 ${label} 没有把 key 又抄一遍字面量`, respelled.join(' ') || '字面量 0 次')
}

console.log('=== PNG 缓存：读、写、失效必须同一条抽象、同一枚常量 ===')
check(logoPng.includes('fileExists(LOGO_PNG_KEY)'),
  'B7 缓存先问抽象在不在', 'fileExists(LOGO_PNG_KEY)')
check(logoPng.includes('downloadFile(LOGO_PNG_KEY)') && logoPng.includes('uploadFile(LOGO_PNG_KEY'),
  'B8 缓存读与写都走 downloadFile/uploadFile', 'downloadFile + uploadFile(LOGO_PNG_KEY)')
check(logoUpload.includes('deleteFile(LOGO_PNG_KEY)'),
  'B9 换标志时删的就是这枚 key', 'deleteFile(LOGO_PNG_KEY)')
check(!/\bfs\.[A-Za-z]+\(/.test(logoPng) && !logoPng.includes('getFilePath('),
  'B10 邮件 PNG 不碰裸 fs／getFilePath（S3 模式下读到的永远是容器里那枚旧文件）',
  'fs.* 与 getFilePath 应为 0 次')

console.log('=== 默认标志不再有「缓存 + 退役文件名枚举」 ===')
check(!brand.includes('default-logo') && !logoPng.includes('default-logo')
  && !logoUpload.includes('default-logo') && !settingsRoute.includes('default-logo'),
  'B11 全仓不再出现 default-logo 那族缓存名（10-07 靠手改 v2 躲过＝没有失效路径）',
  'default-logo 应 0 次')
check(!logoUpload.includes('ACCENT_PRESET_KEYS') && !settingsRoute.includes('ACCENT_PRESET_KEYS'),
  'B12 强调色变化不再枚举失效标志缓存（标志配色已固定，强调色到不了它）', 'ACCENT_PRESET_KEYS 应 0 次')
check(!/fs\.unlink\(/.test(settingsRoute) && !/fs\.unlink\(/.test(logoUpload),
  'B13 两枚设置端点不再裸 fs.unlink 存储里的文件', 'fs.unlink 应 0 次')

console.log('=== 顺手钉住两条不回归 ===')
check(faviconGet.includes('isS3Mode(') && faviconGet.includes('fs.readFile('),
  'B14 favicon GET 两条分支都还在（它是对的，当参照物）', 'isS3Mode + fs.readFile')
check(logoUpload.includes('await uploadFile(') && logoUpload.includes('await deleteFile('),
  'B15 上传/删除仍走 uploadFile / deleteFile（写端本来就对，读端必须跟上）', 'uploadFile + deleteFile')

console.log(`\n合计 ${pass} PASS / ${fail} FAIL`)
process.exit(fail === 0 ? 0 : 1)
