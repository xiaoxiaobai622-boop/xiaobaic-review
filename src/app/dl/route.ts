import { NextResponse } from 'next/server'
import { readDesktopRelease } from '@/lib/desktop-feed'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 一条永不过期的客户端下载地址：/dl → 现读更新源声明的当前版本 → 302 到带版本号的直链。
 *
 * 为什么不直接给 `latest.exe` 那种固定文件名的副本：CDN 的缓存规则是按扩展名配的，
 * exe 默认边缘缓存 30 天，覆盖上传之后旧字节还会继续发给客户。而 `latest.yml` 本来就在
 * 不缓存名单里，所以"当前是哪一版"这个事实只能从它那里读，读一次是一次。
 *
 * 界面入口在 /studio/desktop（先看清版本与大小再下），这条路由留着：它已经发进过
 * 聊天记录和文档，断不得。
 */
export async function GET() {
  const release = await readDesktopRelease()

  if (!release) {
    // 宁可报错也不要"悄悄发一个旧版本"：那样没人会发现，直到客户说装不上
    return new NextResponse('暂时读不到客户端版本信息，请稍后重试。', {
      status: 502,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

  return new NextResponse(null, {
    status: 302,
    headers: {
      location: release.url,
      // 跳转本身绝不能被缓存，否则又回到"发新版但还在跳旧包"的老问题
      'cache-control': 'no-store, max-age=0',
      'x-client-version': release.version,
    },
  })
}
