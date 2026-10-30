import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { filterCommentsForViewer } from '../src/lib/comment-visibility'

const comments: any[] = [
  {
    id: 'public',
    visibility: 'PUBLIC',
    replies: [
      { id: 'public-reply', visibility: 'PUBLIC' },
      { id: 'internal-reply', visibility: 'INTERNAL' },
    ],
  },
  { id: 'internal', visibility: 'INTERNAL', replies: [] },
  { id: 'no-visibility', replies: [] },
]

const failures: string[] = []
function check(ok: boolean, label: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`)
  if (!ok) failures.push(label)
}

const visitor = filterCommentsForViewer(comments, false)
const visitorFirst: any = visitor[0]
check(visitor.map((comment: any) => comment.id).join(',') === 'public,no-visibility', '访客只拿到公开批注')
check(visitorFirst?.replies?.map((reply: any) => reply.id).join(',') === 'public-reply', '访客看不到内部回复')

const team = filterCommentsForViewer(comments, true)
const teamInternal: any = team[1]
check(team.length === comments.length, '团队成员仍能看到全部批注')
check(teamInternal?.id === 'internal', '团队成员保留内部批注')

const commentsRoute = readFileSync(resolve('src/app/api/comments/route.ts'), 'utf8')
const shareRoute = readFileSync(resolve('src/app/api/share/[token]/comments/route.ts'), 'utf8')
check(commentsRoute.includes('filterCommentsForViewer('), '评论主路由接上可见性过滤')
check(shareRoute.includes('filterCommentsForViewer('), '分享评论路由接上可见性过滤')
check(commentsRoute.includes('const isInternal = accessCheck.isAdmin'), '只有团队成员能写内部批注')
check(commentsRoute.includes("accessCheck.isAdmin && visibility === 'INTERNAL'"), '只有团队成员能选择 INTERNAL 可见性')

if (failures.length > 0) {
  console.error(`\n批注可见性 ${failures.length} 项不满足`)
  process.exit(1)
}
console.log('\n批注可见性 8 项全部通过')
