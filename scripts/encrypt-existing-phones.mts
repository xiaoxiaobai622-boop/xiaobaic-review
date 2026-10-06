import { Prisma } from '@prisma/client'
import { prisma } from '../src/lib/db'
import { createPhoneOnlyEmail, isPhoneOnlyEmail } from '../src/lib/user-contact'

/**
 * 把库里已经是明文手机号的历史行改成密文。
 * 写入走正常客户端（那层会加密），所以这里只判断"当前还是明文"这一件事；脚本可重复跑。
 * 摘要列必须已经有值——等值查找靠它，明文列变成密文后就再也查不动了，所以这里先做硬前置检查。
 *
 * 用法：npx tsx scripts/encrypt-existing-phones.mts [--dry]
 */
const dryRun = process.argv.includes('--dry')
const CIPHER = /^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/i

type Row = { id: string; phone: string; hash: string | null }

const tables = [
  {
    label: 'User',
    sql: `select id, phone, "phoneHash" as hash from "User" where phone is not null and phone <> ''`,
    rewrite: (id: string, phone: string) => prisma.user.update({ where: { id }, data: { phone } }),
    remaining: async () => Number((await prisma.$queryRawUnsafe<[{ n: bigint }]>(
      `select count(*)::bigint as n from \"User\" where phone is not null and phone <> '' and phone !~ '^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$'`))[0]?.n ?? 0),
  },
  {
    label: 'TeamInvite',
    sql: `select id, phone, \"phoneHash\" as hash from \"TeamInvite\" where phone is not null and phone <> ''`,
    rewrite: (id: string, phone: string) => prisma.teamInvite.update({ where: { id }, data: { phone } }),
    remaining: async () => Number((await prisma.$queryRawUnsafe<[{ n: bigint }]>(
      `select count(*)::bigint as n from \"TeamInvite\" where phone is not null and phone <> '' and phone !~ '^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$'`))[0]?.n ?? 0),
  },
  {
    label: 'ProjectRecipient',
    sql: `select id, phone, \"phoneHash\" as hash from \"ProjectRecipient\" where phone is not null and phone <> ''`,
    rewrite: (id: string, phone: string) => prisma.projectRecipient.update({ where: { id }, data: { phone } }),
    remaining: async () => Number((await prisma.$queryRawUnsafe<[{ n: bigint }]>(
      `select count(*)::bigint as n from \"ProjectRecipient\" where phone is not null and phone <> '' and phone !~ '^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$'`))[0]?.n ?? 0),
  },
]

async function main() {
  for (const t of tables) {
    const rows = await prisma.$queryRawUnsafe<Row[]>(t.sql)
    const plain = rows.filter(r => !CIPHER.test(r.phone ?? ''))
    const missingHash = plain.filter(r => !r.hash)

    if (missingHash.length) {
      console.log(`  ✗ ${t.label}: ${missingHash.length} 行还没有摘要（先跑 scripts/backfill-phone-hashes.mts），中止`)
      await prisma.$disconnect()
      process.exit(1)
    }

    let done = 0
    if (!dryRun) {
      for (const row of plain) {
        // 读出来是明文（那层不认识就原样返回），写回去时被加密
        await t.rewrite(row.id, row.phone)
        done++
      }
    }

    if (dryRun) {
      console.log(`  [试运行] ${t.label}: 共 ${rows.length} 行带手机号，其中明文 ${plain.length} 行待改写（没写库）`)
      continue
    }
    const stillPlain = await t.remaining()
    console.log(`  ${t.label}: 共 ${rows.length} 行带手机号，其中明文 ${plain.length} 行，已改写 ${done} 行；改写后仍明文 ${stillPlain} 行`)
    if (stillPlain !== 0) { console.log('    ✗ 还有明文残留，别往下走'); await prisma.$disconnect(); process.exit(1) }
  }

  // 占位邮箱以前写作 `phone-<号码>@phone.local`，那是手机号的第二份明文（email 列没有加密）。
  // 换成摘要形式。判据不猜格式，而是「用这行的手机号重算一遍占位邮箱」，与库里存的不一致才改写，
  // 所以同一个人重跑一次就是 no-op。
  const stalePlaceholderEmails = async () => prisma.user.findMany({
    where: { email: { startsWith: 'phone-' } },
    select: { id: true, email: true, phone: true },
  }).then(rows => rows.filter(row => row.phone
    && isPhoneOnlyEmail(row.email)
    && row.email !== createPhoneOnlyEmail(row.phone)))

  const placeholderTotal = await prisma.user.count({ where: { email: { startsWith: 'phone-', endsWith: '@phone.local' } } })
  const orphanPlaceholders = await prisma.user.findMany({
    where: { email: { startsWith: 'phone-', endsWith: '@phone.local' }, phone: null },
    select: { id: true },
  })
  const staleEmails = await stalePlaceholderEmails()
  if (!dryRun) {
    for (const row of staleEmails) {
      await prisma.user.update({ where: { id: row.id }, data: { email: createPhoneOnlyEmail(row.phone!) } })
    }
  }
  console.log(`  占位邮箱：phone- 占位共 ${placeholderTotal} 行，${dryRun ? '待改写（没写库）' : '需改写'} ${staleEmails.length} 行`)
  if (orphanPlaceholders.length) {
    console.log(`  ✗ 有 ${orphanPlaceholders.length} 行占位邮箱没有手机号可换算（${orphanPlaceholders.slice(0, 5).map(r => r.id).join(', ')}），号码仍留在 email 里，需人工处理，中止`)
    await prisma.$disconnect()
    process.exit(1)
  }

  if (dryRun) { await prisma.$disconnect(); process.exit(0) }

  if ((await stalePlaceholderEmails()).length) {
    console.log('  ✗ 占位邮箱改写后仍有带号码的，别往下走')
    await prisma.$disconnect()
    process.exit(1)
  }

  // 抽查：同一个值，库里的字节与应用读回来的必须不同（密文在库、明文在应用）
  const sample = await prisma.user.findFirst({ where: { phone: { not: null } }, select: { id: true, phone: true } })
  if (sample?.id && sample.phone) {
    const raw = await prisma.$queryRawUnsafe<[{ phone: string }]>(`select phone from \"User\" where id = $1`, sample.id)
    const stored = raw[0]?.phone ?? ''
    console.log(`  抽查 user ${sample.id}：库里存 \`${stored.slice(0, 16)}…\`（${stored.length} 字符），应用读回来 \`${sample.phone.slice(0, 3)}****${sample.phone.slice(-4)}\`（${sample.phone.length} 字符）`)
    console.log(`  密文在库、明文在应用：${stored !== sample.phone && CIPHER.test(stored) ? '✅' : '✗ 不对'}`)
    if (!(stored !== sample.phone && CIPHER.test(stored))) { await prisma.$disconnect(); process.exit(1) }
  }

  await prisma.$disconnect()
  process.exit(0)
}

main().catch(async error => {
  console.error('脚本异常：', error)
  await prisma.$disconnect().catch(() => undefined)
  process.exit(2)
})

setTimeout(() => { console.error('超时未退出'); process.exit(3) }, 90000)
