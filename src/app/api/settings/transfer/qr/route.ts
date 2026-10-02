import { NextRequest, NextResponse } from 'next/server'
import { Readable } from 'stream'
import { requirePlatformAdmin } from '@/lib/auth'
import { downloadFile, fileExists } from '@/lib/storage'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = await requirePlatformAdmin(request)
  if (auth instanceof Response) return auth
  // 路径从库里读而不是写死常量：库里存的是当前生效的那张，写死会在换码后继续发旧图。
  const row = await prisma.settings.findUnique({ where: { id: 'default' }, select: { transferQrPath: true } })
  const stored = row?.transferQrPath
  if (!stored) return NextResponse.json({ error: '未上传收款码' }, { status: 404 })
  try {
    // 本地模式下 downloadFile 就是 fs.createReadStream()：文件不存在它照样正常返回流，ENOENT 要等
    // 响应体被消费时才抛，而那时 200 的状态行早就发出去了 —— 下面那个 catch 只在 S3 模式兜得住。
    // 所以必须在这里显式查一次存在性（fileExists 两种存储模式都可用，且把「读不出来」和「不存在」
    // 都算 404）。Task 7 的客户侧收款码读接口照抄这一段，别把这行当成冗余检查简化掉。
    if (!(await fileExists(stored))) {
      return NextResponse.json({ error: '收款码文件读取失败' }, { status: 404 })
    }
    const stream = await downloadFile(stored)
    return new NextResponse(Readable.toWeb(stream) as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': stored.endsWith('.png') ? 'image/png' : 'image/jpeg',
        // 不缓存：这条 URL 永远不变，而 `max-age=300` 就是「换码之后客户最多 5 分钟还在看旧收款码」——
        // 库里改成新键只解决了服务端那一半。实测：同一 URL 在换码后仍从浏览器缓存回旧图（image/png、
        // 185B），不缓存取才拿到新图（image/jpeg、693B）。串取房内多数写法（`auth/session/route.ts:17`、
        // `teams/[id]/route.ts:111`）；`must-revalidate` 单用不算，它在 max-age 内根本不生效。
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      },
    })
  } catch {
    return NextResponse.json({ error: '收款码文件读取失败' }, { status: 404 })
  }
}
