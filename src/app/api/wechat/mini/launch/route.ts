import { NextRequest, NextResponse } from 'next/server'
import { resolveHandoffShare } from '@/lib/share-links'
import { buildMiniShareQuery, toAbsoluteHttpUrl } from '@/lib/share-handoff'
import { generateWechatMiniUrlLink, isWechatMiniConfigured } from '@/lib/wechat-mini-login'
import { getRedis } from '@/lib/redis'
import { getAppUrl } from '@/lib/url'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'

const MINI_SHARE_PAGE = '/pages/share/index'
// URL Link 本身 30 天后失效，缓存少留一天，避免把边角时间里的死链发给访客。
const URL_LINK_CACHE_TTL_SECONDS = 29 * 24 * 60 * 60

function cacheKey(code: string): string {
  // v2: the target moved from the video list to the native share page; a v1
  // entry would keep sending visitors to the old page for its whole 29 days.
  return `wechat:mini:share-link:v2:${code}`
}

export async function POST(request: NextRequest) {
  if (!isWechatMiniConfigured()) {
    return NextResponse.json({ error: '微信小程序尚未配置' }, { status: 503 })
  }

  const body = await request.json().catch(() => ({}))
  const code = typeof body.code === 'string' ? body.code.trim() : ''
  if (!code || code.length > 64) {
    return NextResponse.json({ error: '分享码无效' }, { status: 400 })
  }

  const share = await resolveHandoffShare(code)
  if (!share) {
    return NextResponse.json({ error: '分享链接不可用' }, { status: 404 })
  }

  try {
    const redis = getRedis()
    const cached = await redis.get(cacheKey(share.token))
    if (cached) return NextResponse.json({ urlLink: cached })

    // Owner, avatar and date come from the database, not the request body: the
    // URL Link is cached per code, so client-supplied identity could be replayed
    // to every later visitor of that link.
    const baseUrl = await getAppUrl(request).catch(() => '')
    const query = buildMiniShareQuery(
      share.token,
      share.ownerName,
      toAbsoluteHttpUrl(share.ownerAvatarUrl, baseUrl),
      share.shareDate,
    )
    const urlLink = await generateWechatMiniUrlLink(MINI_SHARE_PAGE, query)
    await redis.set(cacheKey(share.token), urlLink, 'EX', URL_LINK_CACHE_TTL_SECONDS).catch(() => {})
    return NextResponse.json({ urlLink })
  } catch (error) {
    logError('Wechat mini URL link creation failed:', error)
    return NextResponse.json({ error: '小程序链接生成失败，请稍后重试' }, { status: 502 })
  }
}
