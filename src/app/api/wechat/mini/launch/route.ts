import { NextRequest, NextResponse } from 'next/server'
import { resolveActiveShareLink } from '@/lib/share-links'
import { generateWechatMiniUrlLink, isWechatMiniConfigured } from '@/lib/wechat-mini-login'
import { getRedis } from '@/lib/redis'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'

const MINI_VIDEO_LIST_PAGE = '/pages/video-list/index'
// URL Link 本身 30 天后失效，缓存少留一天，避免把边角时间里的死链发给访客。
const URL_LINK_CACHE_TTL_SECONDS = 29 * 24 * 60 * 60

function cacheKey(code: string): string {
  return `wechat:mini:urllink:${code}`
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

  const resolved = await resolveActiveShareLink(code)
  if (!resolved) {
    return NextResponse.json({ error: '分享链接不可用' }, { status: 404 })
  }

  try {
    const redis = getRedis()
    const cached = await redis.get(cacheKey(code))
    if (cached) return NextResponse.json({ urlLink: cached })

    const urlLink = await generateWechatMiniUrlLink(
      MINI_VIDEO_LIST_PAGE,
      `slug=${encodeURIComponent(code)}`,
    )
    await redis.set(cacheKey(code), urlLink, 'EX', URL_LINK_CACHE_TTL_SECONDS).catch(() => {})
    return NextResponse.json({ urlLink })
  } catch (error) {
    logError('Wechat mini URL link creation failed:', error)
    return NextResponse.json({ error: '小程序链接生成失败，请稍后重试' }, { status: 502 })
  }
}
