import { prisma } from '../src/lib/db'

/**
 * passwordSetAt 回填（一次性历史重建，紧跟 20261111210000 迁移跑）。
 *
 * 分工：迁移把「可证明是随机密码」的微信占位邮箱留成 NULL，其余暂记 passwordSetAt = createdAt。
 * 本脚本只负责把短信验证码自动建号那批（phone.local 占位邮箱 + 无用户名 + 默认名＝手机号后四位）
 * 的暂记值清回 NULL——它们的哈希同样是 randomBytes，用户从不知道。手机号列是 AES-GCM 密文，
 * SQL 认不出这批行，所以走应用层解密后判定。
 *
 * 安全闸（保证可重跑、不误伤）：凡 passwordSetAt 非空且 ≠ createdAt 的行，一律视为「用户已通过
 * 应用真实设置过密码」（注册/设置/修改/重置都写 new Date()，必晚于 createdAt），直接跳过，绝不清空。
 * 因此微信/短信用户设过真实密码后重跑本脚本不会被误判回 NULL。脚本只清「仍等于迁移暂记值」的行，
 * 不做 NULL→createdAt 的反向回填（那会把改过昵称、仍持随机密码的短信老号误标成已设置）。
 *
 * 已知局限（见交付报告）：短信自动建号后、迁移前就改过昵称/用户名的老号，形状启发式认不出，
 * 会保留暂记的「已设置」。这批人仍可用短信验证码登录与短信重置找回密码，不会锁死；新代码此后
 * 一律正确写 passwordSetAt，不再产生新的漏判。用 --report 可导出全部占位邮箱行的分类供人工抽查。
 *
 * 用法：node --env-file=.env --import tsx scripts/backfill-password-set-at.mts [--dry] [--report]
 */
const dryRun = process.argv.includes('--dry')
const report = process.argv.includes('--report')

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, phone: true, name: true, username: true, passwordSetAt: true, createdAt: true },
  })

  let wechatCleared = 0
  let smsCleared = 0
  let protectedReal = 0
  let unchanged = 0
  const reportRows: string[] = []

  for (const user of users) {
    const isWechatPlaceholder = user.email.endsWith('@wechat.local')
    const isSmsAutoCreated = user.email.endsWith('@phone.local')
      && !user.username
      && Boolean(user.phone)
      && user.name === user.phone!.slice(-4)
    const placeholderSource = isWechatPlaceholder || isSmsAutoCreated

    // 真实设置值保护闸：非空且不等于迁移暂记值 createdAt ⇒ 用户真实动作，永不触碰。
    if (user.passwordSetAt !== null && user.passwordSetAt.getTime() !== user.createdAt.getTime()) {
      protectedReal++
      if (report && (isWechatPlaceholder || user.email.endsWith('@phone.local'))) {
        reportRows.push(`${user.id}\t${user.email}\tREAL_SET\t${user.passwordSetAt.toISOString()}`)
      }
      continue
    }

    if (report && (isWechatPlaceholder || user.email.endsWith('@phone.local'))) {
      const verdict = placeholderSource ? 'PLACEHOLDER' : 'AMBIGUOUS_KEPT_SET'
      reportRows.push(`${user.id}\t${user.email}\t${verdict}\tname=${user.name ?? ''}\tusername=${user.username ?? ''}`)
    }

    if (placeholderSource) {
      if (user.passwordSetAt === null) { unchanged++; continue }
      // 只会清掉仍等于 createdAt 的迁移暂记值（保护闸已放行真实设置值）。
      if (!dryRun) await prisma.user.update({ where: { id: user.id }, data: { passwordSetAt: null } })
      if (isWechatPlaceholder) wechatCleared++
      else smsCleared++
      continue
    }

    // 非占位来源：迁移已暂记 createdAt，保持不动；不做反向回填。
    unchanged++
  }

  console.log(`${dryRun ? '[dry] ' : ''}共 ${users.length} 行：微信随机密码清 ${wechatCleared}，短信自动建号清 ${smsCleared}，真实设置值保护 ${protectedReal}，不变 ${unchanged}`)
  if (report) {
    console.log('--- 占位邮箱行分类（人工抽查；AMBIGUOUS_KEPT_SET 多为改过昵称/用户名的短信老号）---')
    for (const row of reportRows) console.log(row)
  }
  await prisma.$disconnect()
}

main().catch(async (error) => {
  console.error(error)
  await prisma.$disconnect()
  process.exit(1)
})
