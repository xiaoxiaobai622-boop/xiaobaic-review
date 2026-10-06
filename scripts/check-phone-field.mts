import { prisma, INCLUDE_DELETED } from '../src/lib/db'
import { createPhoneOnlyEmail, hashPhone, normalizePhone, phoneHashField, wherePhone, phoneWhereOrNone, maskPhone, withMaskedPhone, IMPOSSIBLE_PHONE_HASH } from '../src/lib/phone-field'
import { isPhoneOnlyEmail } from '../src/lib/user-contact'
import { revealPhoneNumber } from '../src/lib/personal-data-reveal'

/**
 * 手机号摘要这层的判据：规范化形式要收敛（不同写法同一个摘要）、清号必须连摘要一起清、
 * 过渡期查询要能同时命中"只有明文"和"已有摘要"两种行、非法输入不能退化成全表匹配。
 * 跑法：npx tsx scripts/check-phone-field.mts
 */
const CIPHER_TEST = /^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/i
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
  expect('查询只走摘要列（值列已是密文，明文等值比较没有意义）',
    Object.keys(wherePhone('13800000000') || {}).join(','), 'phoneHash')
  expect('摘要臂的值就是该号码的规范化摘要',
    (wherePhone('+86 138 0000 0000') as any).phoneHash, hashPhone('13800000000'))
  expect('非法输入不得退化成无条件匹配', phoneWhereOrNone(''), { phoneHash: IMPOSSIBLE_PHONE_HASH })
  expect('null 输入同上', phoneWhereOrNone(null), { phoneHash: IMPOSSIBLE_PHONE_HASH })

  console.log('D 透明加解密层（读写都过 prisma 客户端）')
  const probePhone = '13900010002'
  const made = await prisma.user.create({
    data: { email: `probe-${Date.now()}@example.invalid`, phone: probePhone, password: 'x', name: '探针账号' },
    select: { id: true, phone: true },
  })
  const storedRaw = await prisma.$queryRawUnsafe<[{ phone: string }]>(`select phone from \"User\" where id = $1`, made.id)
  expect('写进去的行，应用读回来是明文', made.phone, probePhone)
  expect('同一行在库里的字节不是明文', CIPHER_TEST.test(storedRaw[0]?.phone ?? ''), true)
  expect('库里字节长度明显大于号码本身（是密文不是编码）', (storedRaw[0]?.phone ?? '').length > 32, true)
  const foundByHash = await prisma.user.findFirst({ where: phoneWhereOrNone('+86 139 0001 0002'), select: { id: true } })
  expect('换一种写法仍按摘要查得到这一行', foundByHash?.id, made.id)
  const foundPlainArm = await prisma.user.findFirst({ where: { phone: probePhone }, select: { id: true } })
  expect('明文等值查询已经查不到（说明值真的不是明文）', foundPlainArm, null)
  const cleared = await prisma.user.update({ where: { id: made.id }, data: { phone: null }, select: { phone: true, phoneHash: true } })
  expect('清手机号时摘要一起清掉', cleared.phoneHash, null)
  const keptHash = await prisma.user.findFirst({ where: { phoneHash: hashPhone(probePhone) ?? IMPOSSIBLE_PHONE_HASH }, select: { id: true } })
  expect('清掉之后旧摘要再也找不到人', keptHash, null)
  await prisma.user.delete({ where: { id: made.id } })

  console.log('E 回收站那层没被加解密层带坏（造一枚真墓碑来验）')
  const project = await prisma.project.findFirst({ select: { id: true } })
  if (!project) {
    console.log('  ！dev 库里没有项目，这组跳过（不作数）')
  } else {
    const probe = await prisma.video.create({
      data: {
        projectId: project.id, name: '探针墓碑', version: 1, versionLabel: 'v1',
        originalFileName: 'probe.mp4', originalFileSize: BigInt(1), originalStoragePath: 'probe/does-not-exist.mp4',
        duration: 1, width: 1, height: 1, status: 'READY', deletedAt: new Date(),
      },
      select: { id: true },
    })
    const blindToIt = await prisma.video.findFirst({ where: { id: probe.id }, select: { id: true } })
    const seenWithMarker = await prisma.video.findFirst({ where: { id: probe.id, deletedAt: INCLUDE_DELETED }, select: { id: true } })
    const rawRows = await prisma.$queryRawUnsafe<[{ n: bigint }]>(`select count(*)::bigint as n from \"Video\" where id = $1`, probe.id)
    expect('默认读法看不见刚进回收站的那一行', blindToIt, null)
    expect('带 INCLUDE_DELETED 的读法能看见它', seenWithMarker?.id, probe.id)
    expect('它确实躺在库里（不是没写进去）', Number(rawRows[0].n), 1)
    await prisma.video.delete({ where: { id: probe.id } })
    const left = await prisma.$queryRawUnsafe<[{ n: bigint }]>(`select count(*)::bigint as n from \"Video\" where id = $1`, probe.id)
    expect('探针已删除', Number(left[0].n), 0)
  }

  console.log('F 真库回读（dev）')
  const rows = await prisma.user.findMany({ where: { phone: { not: null } }, take: 5, select: { id: true, phone: true, phoneHash: true } })
  const mism = rows.filter(r => r.phoneHash !== hashPhone(r.phone))
  expect(`已回填的 ${rows.length} 行摘要与算法一致，不符 ${mism.length} 行`, mism.length, 0)
  if (rows.length) {
    const byHash = await prisma.user.findFirst({ where: phoneWhereOrNone(rows[0].phone), select: { id: true } })
    expect('按号码查得到（只走摘要臂）', byHash?.id, rows[0].id)
    const byVariant = await prisma.user.findFirst({ where: phoneWhereOrNone('+' + '86' + rows[0].phone), select: { id: true } })
    expect('换成 +86 写法仍命中同一行', byVariant?.id, rows[0].id)
    const bogus = await prisma.user.findFirst({ where: phoneWhereOrNone(''), select: { id: true } })
    expect('空输入查不到任何人', bogus, null)
  }

  console.log('G 掩码与占位邮箱')
  expect('十一位号码留前三后四', maskPhone('13800000000'), '138****0000')
  expect('旧写法（+86）掩码结果一致', maskPhone('+86 138 0000 0000'), '138****0000')
  expect('没有号码不产出掩码', maskPhone(null), null)
  const maskedRow = withMaskedPhone({ id: 'r1', phone: '13800000000', name: '张三' })
  expect('响应整形只动 phone，其他字段原样', maskedRow, { id: 'r1', phone: '138****0000', name: '张三' })
  const originalRow = { id: 'r1', phone: '13800000000' }
  withMaskedPhone(originalRow)
  expect('整形不改原对象', originalRow.phone, '13800000000')
  const placeholder = createPhoneOnlyEmail('13800000000')
  expect('占位邮箱里不再带着号码本身', placeholder.includes('13800000000'), false)
  expect('占位邮箱同一个号码算同一个地址', createPhoneOnlyEmail('+8613800000000'), placeholder)
  expect('占位邮箱仍被认成占位（界面照旧不显示）', isPhoneOnlyEmail(placeholder), true)

  console.log('H 展开全号要留痕，且痕迹里不能有全号')
  const probeAccount = await prisma.user.create({
    data: { email: `reveal-probe-${Date.now()}@example.invalid`, phone: '13900020003', password: 'x', name: '展开探针' },
    select: { id: true, phone: true },
  })
  const revealed = await revealPhoneNumber({
    kind: 'user',
    subjectId: probeAccount.id,
    stored: probeAccount.phone,
    actorId: probeAccount.id,
    ipAddress: '203.0.113.9',
  })
  const audit = await prisma.securityEvent.findFirst({
    where: { type: 'PERSONAL_DATA_REVEALED' },
    orderBy: { createdAt: 'desc' },
  })
  const auditJson = JSON.stringify(audit?.details ?? {})
  expect('展开接口把号码交回给调用方', revealed, '13900020003')
  expect('审计的 details 里没有全号', auditJson.includes('13900020003'), false)
  expect('审计里只留掩码', (audit?.details as any)?.revealedMasked, '139****0003')
  expect('审计记了被展开的是哪一行', (audit?.details as any)?.revealedId, probeAccount.id)
  expect('审计记了操作人', audit?.userId, probeAccount.id)
  await prisma.securityEvent.deleteMany({ where: { id: audit?.id ?? 'no-such-event' } })
  await prisma.user.delete({ where: { id: probeAccount.id } })
  expect('探针留下的审计行已清掉', await prisma.securityEvent.count({ where: { id: audit?.id ?? 'no-such-event' } }), 0)

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
