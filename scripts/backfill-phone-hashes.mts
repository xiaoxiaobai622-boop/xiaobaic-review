import { prisma } from '../src/lib/db'
import { hashPhone, normalizePhone } from '../src/lib/phone-field'

/**
 * 手机号摘要列回填：迁移只加列、不算值，因为 HMAC 用的是应用里的 ENCRYPTION_KEY，SQL 里拿不到。
 * 先全表算一遍再写，是为了在任何唯一性冲突发生之前就看见它——两个账号的手机号规范化后相同
 * （比如一个存 138…、另一个存 +86138…）会在 User_phoneHash_key 上撞掉，那种情况必须停下人来处理，
 * 不能让脚本写一半。
 *
 * 用法：npx tsx scripts/backfill-phone-hashes.mts [--dry]
 */
const dryRun = process.argv.includes('--dry')

type Row = { id: string; phone: string | null; phoneHash: string | null }
type Target = { label: string; rows: Row[]; write: (id: string, hash: string | null) => Promise<unknown> }

async function main() {
  const targets: Target[] = [
    {
      label: 'User',
      rows: await prisma.user.findMany({ select: { id: true, phone: true, phoneHash: true } }),
      write: (id, hash) => prisma.user.update({ where: { id }, data: { phoneHash: hash } }),
    },
    {
      label: 'TeamInvite',
      rows: await prisma.teamInvite.findMany({ select: { id: true, phone: true, phoneHash: true } }),
      write: (id, hash) => prisma.teamInvite.update({ where: { id }, data: { phoneHash: hash } }),
    },
    {
      label: 'ProjectRecipient',
      rows: await prisma.projectRecipient.findMany({ select: { id: true, phone: true, phoneHash: true } }),
      write: (id, hash) => prisma.projectRecipient.update({ where: { id }, data: { phoneHash: hash } }),
    },
  ]

  let failed = 0

  for (const t of targets) {
    const withPhone = t.rows.filter(r => !!normalizePhone(r.phone))
    const seen = new Map<string, string>()
    const duplicates: string[] = []
    for (const row of withPhone) {
      const hash = hashPhone(row.phone)
      if (!hash) continue
      const prior = seen.get(hash)
      if (prior && prior !== row.id) duplicates.push(`${prior} / ${row.id}`)
      seen.set(hash, row.id)
    }

    if (t.label === 'User' && duplicates.length) {
      console.log(`  ✗ ${t.label}: ${duplicates.length} 组手机号规范化后撞同一个摘要：${duplicates.join('、')}`)
      console.log('    唯一索引会把它们判成重复。先人工并号或改号，再重跑本脚本。')
      failed++
      continue
    }

    const missing = withPhone.filter(r => r.phoneHash !== hashPhone(r.phone))
    let done = 0
    if (!dryRun) {
      for (const row of missing) {
        await t.write(row.id, hashPhone(row.phone))
        done++
      }
    }
    // 手机号被清掉的行必须把摘要一起清掉，否则旧摘要还能把人找出来
    const stale = t.rows.filter(r => !normalizePhone(r.phone) && r.phoneHash)
    if (!dryRun) {
      for (const row of stale) await t.write(row.id, null)
    }

    console.log(`  ${dryRun ? '[试运行] ' : ''}${t.label}: ${withPhone.length} 行有手机号，本次需要写 ${missing.length} 行（实际写 ${done}），清空摘要 ${stale.length} 行，规范化撞车 ${duplicates.length} 组`)
  }

  const left = await prisma.user.count({ where: { phone: { not: null }, NOT: { phone: null }, phoneHash: null } })
  console.log(`  复核：User 里"有手机号但没摘要"还剩 ${left} 行${left === 0 ? ' ✅' : ' ← 未回填完'}`)
  if (dryRun) console.log('  （--dry 模式没有写库）')
  await prisma.$disconnect()
  process.exit(failed === 0 && left === 0 ? 0 : 1)
}

main().catch(async error => {
  console.error('脚本异常：', error)
  await prisma.$disconnect().catch(() => undefined)
  process.exit(2)
})

setTimeout(() => {
  console.error('超时未退出')
  process.exit(3)
}, 90000)
