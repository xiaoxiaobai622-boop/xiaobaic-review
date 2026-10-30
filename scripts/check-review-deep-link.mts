import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildReviewPath } from '../src/lib/deep-link'
import { timecodeToSeekSeconds } from '../src/lib/timecode'

const failures: string[] = []
function check(ok: boolean, label: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`)
  if (!ok) failures.push(label)
}

const path = buildReviewPath({
  projectId: 'p1',
  videoName: 'clip',
  version: 2,
  timecode: '00:00:13:02',
  fps: 25,
  commentId: 'c1',
})
const url = new URL(path, 'http://local')
check(url.pathname === '/studio/projects/p1/share', 'path stays on the review page')
check(url.searchParams.get('video') === 'clip', 'video name is kept')
check(url.searchParams.get('version') === '2', 'version is kept')
const expectedSeconds = String(parseFloat(timecodeToSeekSeconds('00:00:13:02', 25).toFixed(6)))
check(url.searchParams.get('t') === expectedSeconds, 'timecode is converted to seconds')
check(url.searchParams.get('t') !== '00:00:13:02', 'raw timecode is not passed through')
check(url.searchParams.get('comment') === 'c1', 'comment id is kept')

const noFps = buildReviewPath({ projectId: 'p1', videoName: 'clip', timecode: '00:00:13:02' })
check(new URL(noFps, 'http://local').searchParams.get('t') === '13', 'timecode without fps degrades to whole seconds')

const shareClient = readFileSync(resolve('src/app/share/[teamSlug]/SharePageClient.tsx'), 'utf8')
check(shareClient.includes('initialSeekTime={initialSeekTime}'), 'share review forwards initial seek')
check(shareClient.includes('initialVideoIndex={initialVideoIndex}'), 'share review forwards initial version index')
check(shareClient.includes('followLatestVersion={urlVersion === null}'), 'share review follows latest only without a version param')

const studioClient = readFileSync(resolve('src/app/studio/projects/[id]/share/page.tsx'), 'utf8')
check(studioClient.includes('initialSeekTime={initialSeekTime}'), 'studio review forwards initial seek')
check(studioClient.includes('initialVideoIndex={initialVideoIndex}'), 'studio review forwards initial version index')
check(studioClient.includes('followLatestVersion={urlVersion === null}'), 'studio review follows latest only without a version param')

const rail = readFileSync(resolve('src/components/RailNotifications.tsx'), 'utf8')
check(rail.includes('buildReviewPath('), 'in-app notifications use the shared path builder')
check(rail.includes('videoVersion'), 'in-app notifications keep the video version')

const email = readFileSync(resolve('src/lib/email.ts'), 'utf8')
check(email.includes('version: opts.version'), 'email deep link includes the version')

const feishu = readFileSync(resolve('src/app/api/feishu/push/route.ts'), 'utf8')
check(feishu.includes('commentId:'), 'Feishu card link includes a comment id')
check(feishu.includes('timecode:'), 'Feishu card link includes the timecode')

if (failures.length > 0) {
  console.error(`\n审片深链 ${failures.length} 项不满足`)
  process.exit(1)
}
console.log('\n审片深链 18 项全部通过')
