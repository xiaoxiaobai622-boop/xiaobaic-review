/**
 * 判据：品牌图的「读」必须跟着「写」走同一套存储抽象。
 *
 * 起因（10-07）：线上是 S3/COS 模式，`POST /api/settings/logo` 用 uploadFile 写进对象存储，
 * 而 `GET /api/branding/logo` 与邮件用的 `GET /api/branding/logo-png` 只 `fs.readFile(getFilePath(...))`
 * 读容器本地盘 ⇒ 他每次换自定义标志都"回去了"（读到的是镜像里那份旧文件）。
 * 同一页的 favicon 之所以能换成功，是因为 `/api/branding/favicon` 两条分支都写了。
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

console.log('=== 读端要分两条路（S3 / 本地）===')
check(logoGet.includes('isS3Mode('), 'B1 标志 GET 有 S3 分支', 'isS3Mode(')
check(logoGet.includes('s3FileExists(') && logoGet.includes('s3GetPresignedDownloadUrl('),
  'B2 标志 GET 的 S3 分支照 favicon 那套探在不在、再 302 到预签名地址', 's3FileExists + s3GetPresignedDownloadUrl')
check(/status:\s*302|,\s*302\s*\)/.test(logoGet) || logoGet.includes('redirect('),
  'B3 标志 GET 会 302（不把字节代理过 Node）', 'redirect/302')

console.log('=== 读写路径必须同名 ===')
const uploadPath = logoUpload.match(/const STORAGE_PATH = '([^']+)'/)?.[1] ?? ''
check(!!uploadPath && logoGet.includes(`'${uploadPath}'`),
  'B4 标志 GET 读的就是上传写进去的那枚 key', `${uploadPath || '(没解析到)'} ↔ GET`)
check(!!uploadPath && logoPng.includes(`'${uploadPath}'`),
  'B5 邮件 PNG 读的也是同一枚 key', `${uploadPath || '(没解析到)'} ↔ logo-png`)

console.log('=== 邮件 PNG 不许再只盯本地盘 ===')
check(!/fs\.access\(customLogoPath\)/.test(logoPng),
  'B6 不再用 fs.access 判自定义标志在不在（S3 模式下永远判不到）', 'fs.access(customLogoPath) 应为 0 次')
check(logoPng.includes('fileExists(') && logoPng.includes('downloadFile('),
  'B7 改用 storage 抽象 fileExists + downloadFile', 'fileExists + downloadFile')

console.log('=== 顺手钉住两条不回归 ===')
check(faviconGet.includes('isS3Mode(') && faviconGet.includes('fs.readFile('),
  'B8 favicon GET 两条分支都还在（它是对的，当参照物）', 'isS3Mode + fs.readFile')
check(logoUpload.includes('await uploadFile(') && logoUpload.includes('await deleteFile('),
  'B9 上传/删除仍走 uploadFile / deleteFile（写端本来就对，读端必须跟上）', 'uploadFile + deleteFile')

console.log(`\n合计 ${pass} PASS / ${fail} FAIL`)
process.exit(fail === 0 ? 0 : 1)
