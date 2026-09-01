import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const admin = await prisma.user.findFirst({
    where: { email: 'admin@example.com' }
  })

  if (!admin) {
    console.log('未找到 admin@example.com 账号')
    return
  }

  await prisma.user.update({
    where: { id: admin.id },
    data: { phone: '13800138000' }
  })

  console.log('✓ 已将管理员账号绑定手机号: 13800138000')
  console.log('✓ 现在可以用 13800138000 / LocalDev123! 登录')
}

main()
  .then(() => prisma.$disconnect())
  .catch(e => {
    console.error(e)
    prisma.$disconnect()
    process.exit(1)
  })
