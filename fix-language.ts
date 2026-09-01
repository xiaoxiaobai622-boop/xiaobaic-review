import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const result = await prisma.settings.upsert({
    where: { id: 'default' },
    update: { language: 'zh' },
    create: { id: 'default', language: 'zh' },
  })

  console.log('✓ 语言已设置为中文:', result.language)
}

main()
  .catch((e) => {
    console.error('错误:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
