import { prisma } from '../src/lib/db'
import { hashPhone, normalizePhone, phoneHashField, wherePhone, phoneWhereOrNone, IMPOSSIBLE_PHONE_HASH } from '../src/lib/phone-field'

/**
 * 手机号摘要这层的判据：规范化形式要收敛（不同写法同一个摘要）、清号必须连摘要一起清、
 * 过渡期查询要能同时命中"只有明文"和"已有摘要"两种行、非法输入不能退化成全表匹配。
 * 跑法：npx tsx scripts/check-phone-field.mts
 */
let failures = 0
function expect(label: string, actual: unknown, want: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(want)
  if (!ok) { failures++; console.log(`  ✗ ${label}\n     实际 ${JSON.stringify(actual)}\n     期望 ${JSON.stringify(want)}`) }
  else console.log(`  ✓ ${label}`)
}

async function main() {
  console.log('A 规范化与摘要')
  const variants = ['13800000000', '+8613800000000', '86 138 0000 0000', '138-0000-0000', '（138）00000000']
  const hashes = variants.map(v => hashPhone(v))
  expect('五种写法收敛到同一个摘要', new Set(hashes).size, 1)
  expect('规范化去掉 +86 前缀', normalizePhone('+8613800000000'), '13800000000')
  expect('空输入不产摘要', hashPhone('   '), null)
  expect('非数字输入不产摘要（上游本来就用 Zod 卡过格式）', hashPhone('abc'), null)
  expect('摘要与明文不同源（不是简单哈希直出）', hashPhone('13800000000') === hashPhone('13800000001'), false)

  console.log('B 写入与清空')
  expect('有值时写摘要', phoneHashField('13800000000'), { phoneHash: hashPhone('13800000000') })
  expect('清空手机号必须连摘要一起清', phoneHashField(null), { phoneHash: null })
  expect('空串也按清空处理', phoneHashField('  '), { phoneHash: null })

  console.log('C 过渡期查询')
  expect('正常输入是 OR 两臂', Object.keys(wherePhone('13800000000') || {}).join(','), 'OR')
  expect('两臂分别是摘要与规范化明文',
    (wherePhone('+86 138 0000 0000') as any).OR.map((o: any) => Object.keys(o)[0]).sort().join(','), 'phone,phoneHash')
  expect('非法输入不得退化成无条件匹配', phoneWhereOrNone(''), { phoneHash: IMPOSSIBLE_PHONE_HASH })
  expect('null 输入同上', phoneWhereOrNone(null), { phoneHash: IMPOSSIBLE_PHONE_HASH })

  console.log('D 真库回读（dev）')
  const rows = await prisma.user.findMany({ where: { phone: { not: null } }, take: 5, select: { id: true, phone: true, phoneHash: true } })
  const mism = rows.filter(r => r.phoneHash !== hashPhone(r.phone))
  expect(`已回填的 ${rows.length} 行摘要与算法一致，不符 ${mism.length} 行`, mism.length, 0)
  if (rows.length) {
    const byHash = await prisma.user.findFirst({ where: phoneWhereOrNone(rows[0].phone), select: { id: true } })
    expect('按明文查得到（摘要臂或明文臂命中）', byHash?.id, rows[0].id)
    const byVariant = await prisma.user.findFirst({ where: phoneWhereOrNone('+' + '86' + rows[0].phone), select: { id: true } })
    expect('换成 +86 写法仍命中同一行', byVariant?.id, rows[0].id)
    const bogus = await prisma.user.findFirst({ where: phoneWhereOrNone(''), select: { id: true } })
    expect('空输入查不到任何人', bogus, null)
  }

  await prisma.$disconnect()
  console.log(failures === 0 ? '\n全部通过' : `\n失败 ${failures} 条`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async error => {
  console.error('脚本异常：', error)
  await prisma.$disconnect().catch(() => undefined)
  process.exit(2)
})

setTimeout(() => { console.error('超时未退出'); process.exit(3) }, 90000)
