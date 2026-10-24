import {
  emailSchema,
  urlSchema,
  notificationUrlSchema,
  updateProjectSchema,
  createNotificationDestinationSchema,
  createCommentSchema,
  createProjectSchema,
  loginSchema,
} from '../src/lib/validation'

/**
 * Zod 4 migration guards. These are the runtime shapes the API actually parses,
 * not source-level assumptions: a schema that compiles can still reject the
 * partial records the settings UI sends.
 */

let passed = 0
const failures: string[] = []
function check(name: string, ok: boolean, detail = '') {
  if (ok) passed += 1
  else failures.push(`${name}${detail ? ` → ${detail}` : ''}`)
}

const cuid = 'c' + 'a'.repeat(24)
const gotify = {
  provider: 'GOTIFY',
  name: 'probe',
  enabled: true,
  config: { baseUrl: 'https://gotify.example.com' },
  secrets: { appToken: 'a'.repeat(24) },
}
const allEvents = {
  SHARE_ACCESS: true,
  ADMIN_ACCESS: false,
  CLIENT_COMMENT: true,
  VIDEO_APPROVAL: false,
  SECURITY_ALERT: true,
  TEST: false,
}

check('Z1 通知订阅允许只传已勾选的事件（v4 的 z.record 会要求全键）',
  createNotificationDestinationSchema.safeParse({ ...gotify, subscriptions: { SHARE_ACCESS: true } }).success)
check('Z2 通知订阅也接受完整六键',
  createNotificationDestinationSchema.safeParse({ ...gotify, subscriptions: allEvents }).success)
check('Z3 未知事件名仍被拒绝',
  !createNotificationDestinationSchema.safeParse({ ...gotify, subscriptions: { BOGUS: true } }).success)
check('Z4 合法邮箱通过、缺 @ 的邮箱被拒绝',
  emailSchema.safeParse('User.Name+tag@example.co.uk').success
  && !emailSchema.safeParse('a@b').success)
check('Z5 内网通知地址通过、云元数据地址被拒绝',
  urlSchema.safeParse('http://192.168.1.10:8080').success
  && !notificationUrlSchema.safeParse('http://169.254.169.254/').success)
check('Z6 ISO 到期时间通过、只有日期的字符串被拒绝',
  updateProjectSchema.safeParse({ dueDate: '2026-10-24T00:00:00.000Z' }).success
  && !updateProjectSchema.safeParse({ dueDate: '2026-10-24' }).success)
check('Z7 批注正文与邮箱照常通过',
  createCommentSchema.safeParse({
    projectId: cuid,
    videoId: cuid,
    timecode: '00:00:01:00',
    content: '<p>hello</p>',
    authorEmail: 'a@b.com',
  }).success)
check('Z8 手机号登录与带 cuid 的项目都通过',
  loginSchema.safeParse({ email: '13211472851', password: 'x' }).success
  && createProjectSchema.safeParse({ title: 'probe', clientCompanyId: cuid }).success)

console.log(`\n合计 ${passed} PASS / ${failures.length} FAIL`)
for (const failure of failures) console.log(`  FAIL  ${failure}`)
process.exit(failures.length === 0 ? 0 : 1)
