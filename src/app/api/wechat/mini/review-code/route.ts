import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { resolveActiveShareLink } from '@/lib/share-links'
import { generateWechatMiniQrCode, isWechatMiniConfigured } from '@/lib/wechat-mini-login'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'

const MINI_VIDEO_LIST_PAGE = 'pages/video-list/index'

export async function GET(request: NextRequest) {
  if (!isWechatMiniConfigured()) {
    return NextResponse.json({ error: '微信小程序尚未配置' }, { status: 503 })
  }

  const code = request.nextUrl.searchParams.get('code')?.trim() || ''
  if (!code || code.length > 64) {
    return NextResponse.json({ error: '分享码无效' }, { status: 400 })
  }

  const resolved = await resolveActiveShareLink(code)
  if (!resolved) {
    return NextResponse.json({ error: '分享链接不可用' }, { status: 404 })
  }

  try {
    const qr = await generateWechatMiniQrCode(code, MINI_VIDEO_LIST_PAGE, 420)
    // 微信这个接口实际回的是 JPEG；响应头写 PNG 就必须真的换成 PNG。
    const png = await sharp(qr).png().toBuffer()
    return new NextResponse(new Uint8Array(png), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    logError('Wechat mini review QR creation failed:', error)
    return NextResponse.json({ error: '小程序码生成失败，请稍后重试' }, { status: 502 })
  }
}
