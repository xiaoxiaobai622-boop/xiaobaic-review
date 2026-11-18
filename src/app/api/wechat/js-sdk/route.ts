import { NextRequest, NextResponse } from 'next/server'
import { getWechatJsSdkConfig, isWechatJsSdkConfigured } from '@/lib/wechat-js-sdk'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get('url')?.trim() || ''
  if (!rawUrl) {
    return NextResponse.json({ error: '缺少页面地址' }, { status: 400, headers: NO_STORE })
  }

  // WeChat signs location.href without the hash; the client already strips it,
  // but accepting a stray fragment here would sign a different string.
  const pageUrl = rawUrl.split('#')[0]
  let parsed: URL
  try {
    parsed = new URL(pageUrl)
  } catch {
    return NextResponse.json({ error: '页面地址无效' }, { status: 400, headers: NO_STORE })
  }

  if (parsed.protocol !== 'https:' || parsed.host !== 'vidx.cn') {
    return NextResponse.json({ error: '只允许 vidx.cn 的页面签名' }, { status: 400, headers: NO_STORE })
  }

  if (!isWechatJsSdkConfigured()) {
    return NextResponse.json({ error: '微信 JS-SDK 尚未配置' }, { status: 503, headers: NO_STORE })
  }

  try {
    const config = await getWechatJsSdkConfig(pageUrl)
    return NextResponse.json(config, { headers: NO_STORE })
  } catch (error) {
    logError('WeChat JS-SDK signing failed:', error)
    return NextResponse.json({ error: '微信签名生成失败' }, { status: 502, headers: NO_STORE })
  }
}
