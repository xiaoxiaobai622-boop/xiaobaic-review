import { NextRequest, NextResponse } from 'next/server'
import { Readable } from 'stream'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { getActiveTeamMembership, getRequestedTeamId } from '@/lib/team-access'
import { downloadFile, fileExists } from '@/lib/storage'
import { getTransferConfig } from '@/lib/settings'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Task 5 的 `/api/settings/transfer/qr` 要平台管理员令牌，`<img src>` 带不上 Authorization，
// 而 `PaymentIntent.qrPath` 只是存储键不是 URL —— 客户要看码就必须有这一条团队侧读接口。
//
// 门禁与订单列表 GET 完全一致：任意 ACTIVE 成员可看（看码不需要花钱的权限），团队被平台停用
// 则整条账单面消失。这里刻意不查 Order：收款码是全团队共用的那一张，跟具体哪张单无关。
export async function GET(request: NextRequest) {
  const user = await getCurrentUserFromRequest(request)
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 })
  if (!(await getActiveTeamMembership(user, getRequestedTeamId(request)))) {
    return NextResponse.json({ error: '无权访问' }, { status: 403 })
  }

  const config = await getTransferConfig()
  if (!config.qrPath) return NextResponse.json({ error: '平台尚未上传收款码' }, { status: 404 })
  try {
    // 与 Task 5 的读接口同一刀（`settings/transfer/qr/route.ts:22`）：local 模式下 `downloadFile()`
    // 对不存在的文件不抛错，200 已经发出去才 ENOENT —— 所以这道存在性守卫不能省。
    // 但它必须在 try **里面**：`storage.ts:191-194` 说 S3 模式下真实存储错误会从 `fileExists`
    // 抛出来（只有路径校验失败才咽成 `false`），放外面等于「bucket 挂了 / 凭证 403 ⇒ 无人接的
    // throw ⇒ 框架裸 500 且没有 logError」，跟下面那句「读不出来回 404」自相矛盾。
    if (!(await fileExists(config.qrPath))) return NextResponse.json({ error: '平台尚未上传收款码' }, { status: 404 })
    const stream = await downloadFile(config.qrPath)
    return new NextResponse(Readable.toWeb(stream) as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': config.qrPath.endsWith('.png') ? 'image/png' : 'image/jpeg',
        // 这条 URL 永远不变，所以任何 max-age 都是「运营换了码、客户还在往旧账号打钱」的窗口。
        // 与 Task 5 的读接口实测过的串保持一致（房内多数写法）。
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      },
    })
  } catch (error) {
    // 文件读不出来时给 404 而不是 500：客户界面上「这张单没有图」比「下单失败」更接近真相。
    // 守卫挪进 try 之后，S3 模式下 `fileExists` 抛出来的真实存储错误也走这一支。
    logError('[BILLING:TRANSFER_QR] read failed', error)
    return NextResponse.json({ error: '平台尚未上传收款码' }, { status: 404 })
  }
}
