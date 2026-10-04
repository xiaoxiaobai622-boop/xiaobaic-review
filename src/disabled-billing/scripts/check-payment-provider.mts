import { getPaymentProvider } from '../src/lib/payment-provider'
import { getTransferConfig } from '../src/lib/settings'
import { createOrder } from '../src/lib/billing'
import { BillingError } from '../src/lib/billing-pricing'
import { hashPassword } from '@/lib/encryption'
import { prisma } from '../src/lib/db'

let passed = 0
const failures: string[] = []
function expect(name: string, actual: unknown, want: unknown) {
  const ok = typeof want === 'number' && typeof actual === 'number'
    ? Math.abs(actual - want) < 1e-9
    : actual === want
  if (ok) passed += 1
  else failures.push(`${name}\n      expected ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`)
}
async function expectCode(name: string, fn: () => Promise<unknown>, code: string) {
  try { await fn(); failures.push(`${name}\n      expected ${code}, got none`) }
  catch (e) {
    if (e instanceof BillingError && e.code === code) passed += 1
    else failures.push(`${name}\n      expected ${code}, got ${String(e)}`)
  }
}

const p = getPaymentProvider()
expect('phase 1 default provider is manual', p.key, 'manual')
await expectCode('verifyCallback is not implemented', () => p.verifyCallback(new Request('http://x')), 'NOT_IMPLEMENTED')
await expectCode('refund is not implemented', () => p.refund({ orderId: 'o', amountCents: 1 }), 'NOT_IMPLEMENTED')
await expectCode('wechat is not registered yet', () => Promise.resolve().then(() => getPaymentProvider('wechat')), 'NOT_IMPLEMENTED')

const intentInput = { id: 'i-1', reference: 'RV-AB23DE', amountCents: 123_400, currency: 'CNY' }

// 只读：绝不写 Settings —— 那是他本地真实的运营配置行，所以两条分支都必须走得通。
const cfg = await getTransferConfig()
expect('transfer config exposes exactly six keys', Object.keys(cfg).sort().join(','),
  'accountName,accountNo,bank,configured,note,qrPath')
if (cfg.configured) {
  // 钉的是「钱由订单决定，不由收款配置决定」：转账说明里的金额和汇款备注必须
  // 原样是传进来的那一单的值，而不是 provider 回头重算的。
  const intent = await p.createIntent(intentInput)
  expect('instructions echo the order amount', intent.kind === 'instructions' && intent.amountCents, 123_400)
  expect('instructions echo the order reference', intent.kind === 'instructions' && intent.reference, 'RV-AB23DE')
} else {
  await expectCode('an unconfigured transfer account blocks the intent',
    () => p.createIntent(intentInput), 'NO_TRANSFER_CONFIG')
}

// `markPaid` 的两条规则必须真跑一遍，而不是靠读：抢到状态迁移的那次点击给
// PaymentAttempt 落章，抢不到的那次不许改章（那等于上报一笔这次点击没完成的付款）。
// 清场手法照抄 scripts/check-billing-flow.mts 的 finally：自建一次性用户/团队/订单，
// 按 FK 顺序删，且不吞异常 —— 他的本地库里装着真实团队数据。
const stamp = Date.now()
const actor = await prisma.user.create({
  data: { email: `pp-check-${stamp}@example.invalid`, name: 'pp-check', password: await hashPassword(`pp-check-${stamp}`) },
})
// 两个身份：只有一个 actor 时 `confirmed:${actorUserId}` 分不出是谁落的章，
// 「败者不许改章」那条断言就成了永真。
// `actor` 建完立刻进 try（同 check-billing-flow.mts 的 M-7）：建第二个身份时一旦抛了，
// 第一个身份也必须被清掉 —— 这个库里装着真实团队数据。
let otherId: string | null = null
let teamId: string | null = null
try {
  const other = await prisma.user.create({
    data: { email: `pp-check2-${stamp}@example.invalid`, name: 'pp-check2', password: await hashPassword(`pp-check2-${stamp}`) },
  })
  otherId = other.id
  const team = await prisma.team.create({
    data: { name: `pp-check-${stamp}`, slug: `pp-check-${stamp}`, shareKey: `pc-${stamp}`, createdById: actor.id },
  })
  teamId = team.id
  const { order } = await prisma.$transaction((tx) =>
    createOrder(tx, { teamId: team.id, planKey: 'MONTHLY', periods: 1, actorUserId: actor.id }))
  const attempt = () => prisma.paymentAttempt.findFirst({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } })

  const won = await p.markPaid({ orderId: order.id, actorUserId: actor.id })
  expect('winning click confirms the order', won.ok, true)
  expect('winning click settles the attempt', (await attempt())?.status, 'SUCCEEDED')
  expect('the stamp names the winning actor', (await attempt())?.providerRef, `confirmed:${actor.id}`)

  const lost = await p.markPaid({ orderId: order.id, actorUserId: other.id })
  expect('losing click reports the conflict', lost.ok, false)
  expect('losing click leaves the stamp alone', (await attempt())?.providerRef, `confirmed:${actor.id}`)
} finally {
  // Order.teamId / Order.createdById 是 RESTRICT，attempts/events 随 Order CASCADE。
  if (teamId) await prisma.order.deleteMany({ where: { teamId } })
  if (teamId) await prisma.team.delete({ where: { id: teamId } })
  if (otherId) await prisma.user.delete({ where: { id: otherId } })
  await prisma.user.delete({ where: { id: actor.id } })
}

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) console.log(failures.join('\n'))
// 必须断链：src/lib/db.ts 导出的是进程级单例，连接池不放手这个脚本就永远不退出。
await prisma.$disconnect()
process.exit(failures.length ? 1 : 0)
