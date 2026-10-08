import { NextResponse } from 'next/server'

/**
 * 一条永不过期的客户端下载地址：/dl → 现读更新源声明的当前版本 → 302 到带版本号的直链。
 *
 * 为什么不直接给 `latest.exe` 那种固定文件名的副本：CDN 的缓存规则是按扩展名配的，
 * exe 默认边缘缓存 30 天，覆盖上传之后旧字节还会继续发给客户。而 `latest.yml` 本来就在
 * 不缓存名单里，所以"当前是哪一版"这个事实只能从它那里读，读一次是一次。
 */
// 默认就是线上更新源；留一个环境变量口子，是为了能拿本地假源证明"发新版会自动跟"，
// 以及以后换桶/换域名时不用改代码。
const FEED = process.env.DESKTOP_FEED_URL ?? 'https://dl.vidx.cn/desktop/'

export const dynamic = 'force-dynamic'

export async function GET() {
  let file: string | null = null
  let version: string | null = null
  try {
    const res = await fetch(`${FEED}latest.yml`, { cache: 'no-store' })
    if (res.ok) {
      const yml = await res.text()
      file = yml.match(/^path:\s*(\S+)\s*$/m)?.[1] ?? null
      version = yml.match(/^version:\s*([\d.]+)\s*$/m)?.[1] ?? null
    }
  } catch {
    file = null
  }

  if (!file) {
    // 宁可报错也不要"悄悄发一个旧版本"：那样没人会发现，直到客户说装不上
    return new NextResponse('暂时读不到客户端版本信息，请稍后重试。', {
      status: 502,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    })
  }

  return new NextResponse(null, {
    status: 302,
    headers: {
      location: `${FEED}${file}`,
      // 跳转本身绝不能被缓存，否则又回到"发新版但还在跳旧包"的老问题
      'cache-control': 'no-store, max-age=0',
      ...(version ? { 'x-client-version': version } : {}),
    },
  })
}
