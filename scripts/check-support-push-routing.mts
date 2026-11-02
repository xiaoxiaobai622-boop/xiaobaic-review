import { existsSync, readFileSync } from 'node:fs'

/**
 * 客服推送只走客服 surface；项目事件按项目团队 OWNER/ADMIN 路由；安全/登录只到平台管理员。
 * 这里钉的是结构：surface 收口、同 endpoint 不跨 surface 覆盖、发送端按受众选人、历史行迁移。
 * 真正的收件人矩阵另由 scripts/verify-push-routing.mts 在一次性测试库上跑。
 */
const read = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8') : '')
const pushSetup = read('src/components/support/PlatformPushSetup.tsx')
const subscribe = read('src/app/api/push/subscribe/route.ts')
const push = read('src/lib/push-notifications.ts')
const webPush = read('src/components/settings/WebPushSection.tsx')
const migration = read('prisma/migrations/20261102090000_add_push_surface_routing/migration.sql')

let failures = 0
function check(ok: boolean, label: string, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` → ${detail}` : ''}`)
  if (!ok) failures++
}

check(
  /surface:\s*'support'/.test(pushSetup) && /subscribedEvents:\s*\[\s*'SUPPORT_NEW_MESSAGE'\s*\]/.test(pushSetup),
  'P1 客服 PWA 订阅只带客服事件和 support surface',
)
check(
  /surface\s*===\s*'support'/.test(subscribe) &&
    /SUPPORT_NEW_MESSAGE/.test(read('src/lib/push-access.ts')) &&
    /surface\s*===\s*'support'/.test(read('src/lib/push-access.ts')),
  'P2 服务端把 support surface 强制收口到客服事件',
)
check(
  /existing\.surface\s*!==\s*surface/.test(subscribe) && /409/.test(subscribe),
  'P3 同一 endpoint 跨 surface 时拒绝覆盖',
)
check(
  /selectPushSubscriptions/.test(push) &&
    /surface:\s*'support'/.test(push) &&
    /isPlatformAdmin/.test(push) &&
    /teamMember/.test(push) &&
    /'OWNER'/.test(push) &&
    /'ADMIN'/.test(push),
  'P4 发送端按 support / 平台管理员 / 项目团队管理员选收件人',
)
check(/pushDeliveryLog/.test(push), 'P5 推送投递写审计日志')
check(
  /"surface"/.test(migration) && /运营 PWA/.test(migration) && /SUPPORT_NEW_MESSAGE/.test(migration),
  'P6 历史运营 PWA 订阅迁移为 support + 仅客服事件',
)
check(
  /const PUSH_EVENT_TYPES[\s\S]{0,240}SUPPORT_NEW_MESSAGE/.test(webPush) &&
    /ADMIN_ACCESS/.test(webPush) &&
    /SHARE_ACCESS/.test(webPush) &&
    /surface/.test(webPush),
  'P7 主 App 的推送事件列表排除客服/登录/访问事件并识别 support 设备',
)
check(
  /只接收|主 App/.test(pushSetup),
  'P8 客服入口写明只收客服消息、其他通知去主 App',
)

const loginRoute = read('src/app/api/auth/login/route.ts')
const passkeyVerify = read('src/app/api/auth/passkey/authenticate/verify/route.ts')
const shareTracking = read('src/lib/share-access-tracking.ts')
const sendOtp = read('src/app/api/share/[token]/send-otp/route.ts')
const enqueue = read('src/lib/external-notifications/enqueueExternalNotification.ts')
const appriseWorker = read('src/worker/external-notifications/processExternalNotificationJob.ts')

check(
  !/eventType:\s*'ADMIN_ACCESS'/.test(loginRoute) &&
    !/eventType:\s*'ADMIN_ACCESS'/.test(passkeyVerify) &&
    !/eventType:\s*'SHARE_ACCESS'/.test(shareTracking) &&
    !/eventType:\s*'SHARE_ACCESS'/.test(sendOtp),
  'P9 登录/访问事件不再从来源处发消息',
)
check(
  /AUDIT_ONLY_EVENTS/.test(enqueue) && /ADMIN_ACCESS/.test(enqueue) && /SHARE_ACCESS/.test(enqueue) &&
    /audit-only/.test(appriseWorker),
  'P10 Apprise 队列对登录/访问事件禁发',
)
check(
  /AUDIT_ONLY_PUSH_EVENTS/.test(push) && /audit-only/.test(push),
  'P11 推送选择层把登录/访问事件判为 0 收件人',
)

const pushAccess = read('src/lib/push-access.ts')
const teamPush = read('src/components/TeamPushSetup.tsx')
const statusRoute = read('src/app/api/push/status/route.ts')
const teamPage = read('src/app/studio/team/page.tsx')
const emailSources = [
  read('src/lib/notifications.ts'),
  read('src/lib/upload-notifications.ts'),
  read('src/worker/due-date-reminders.ts'),
  read('src/worker/studio-notifications.ts'),
]
const dueDateWorker = read('src/worker/due-date-reminders.ts')
const zhMessages = read('src/locales/zh.json')

check(
  /TEAM_PUSH_EVENT_TYPES/.test(pushAccess) &&
    /isTeamAdmin/.test(pushAccess) &&
    /teamMember/.test(pushAccess) &&
    /eventsForPushActor/.test(pushAccess),
  'P12 普通团队管理员可订阅，事件收口到团队事件',
)
check(
  /TeamPushSetup/.test(teamPage) && /surface/.test(teamPush) && /support/.test(teamPush),
  'P13 团队页有订阅入口并识别客服冲突',
)
check(
  /\/api\/push\/status/.test(pushSetup) && /\/api\/push\/status/.test(teamPush) && /subscription/.test(statusRoute),
  'P14 客服/团队入口先查共享 SW 的 surface 归属',
)
check(
  emailSources.every((source) => !/role:\s*'ADMIN'/.test(source)) &&
    emailSources.every((source) => source === '' || /getProjectTeamAdmin/.test(source)),
  'P15 admin 邮件按项目团队 OWNER/ADMIN 收口',
)
check(
  /pushData:\s*\{[\s\S]{0,160}projectId:\s*project\.id/.test(dueDateWorker),
  'P16 到期提醒带上 projectId',
)
check(/platformLevelNote/.test(zhMessages), 'P17 Apprise 平台级范围有用户可见说明')
check(
  /requirePushActor/.test(read('src/app/api/push/unsubscribe/route.ts')) &&
    /userId:\s*actor\.user\.id/.test(read('src/app/api/push/unsubscribe/route.ts')),
  'P18 团队管理员可退订自己的订阅，且按 userId 限定',
)

if (failures > 0) {
  console.error(`\n=== 客服推送路由判据 ${failures} 项未满足 ===`)
  process.exit(1)
}
console.log('\n=== 客服推送路由判据全部通过 ===')
