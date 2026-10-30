import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { canDownloadMedia } from '../src/lib/download-permission'

const failures: string[] = []
function check(ok: boolean, label: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`)
  if (!ok) failures.push(label)
}

check(canDownloadMedia({ permissions: ['view'] }) === false, 'view-only link cannot download')
check(canDownloadMedia({ permissions: ['view', 'download'] }) === true, 'download permission can download')
check(canDownloadMedia({ permissions: ['view'], isAdmin: true }) === true, 'admin token can download')
check(canDownloadMedia({ permissions: ['view'], isClientUploadedAsset: true }) === true, 'client-uploaded attachment stays downloadable')
check(canDownloadMedia({ permissions: undefined }) === false, 'legacy token without permissions fails closed')

const contentRoute = readFileSync(resolve('src/app/api/content/[token]/route.ts'), 'utf8')
check(contentRoute.includes('canDownloadMedia('), 'content route checks the token download grant')
check(contentRoute.includes('verifiedToken.permissions'), 'content route passes token permissions')

const photoRoute = readFileSync(resolve('src/app/api/content/photo/[token]/route.ts'), 'utf8')
check(photoRoute.includes('canDownloadMedia('), 'photo content route checks the token download grant')
check(photoRoute.includes('verifiedToken.permissions'), 'photo content route passes token permissions')

const videoAccess = readFileSync(resolve('src/lib/video-access.ts'), 'utf8')
check(videoAccess.includes('permissions?: string[]'), 'video token stores link permissions')

const videoTokenRoute = readFileSync(resolve('src/app/api/share/[token]/video-token/route.ts'), 'utf8')
check(videoTokenRoute.includes('permissions: linkPermissions('), 'share video token carries link permissions')

const photoAlbumsRoute = readFileSync(resolve('src/app/api/projects/[id]/photo-albums/route.ts'), 'utf8')
check(photoAlbumsRoute.includes('shareContext?.permissions'), 'album token carries link permissions')

if (failures.length > 0) {
  console.error(`\n下载权限 ${failures.length} 项不满足`)
  process.exit(1)
}
console.log('\n下载权限 12 项全部通过')
