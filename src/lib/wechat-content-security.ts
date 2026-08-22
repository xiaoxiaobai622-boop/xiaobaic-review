import { prisma } from '@/lib/db'
import { getWechatMiniAccessToken, isWechatMiniConfigured } from '@/lib/wechat-mini-login'
import { getRedis } from '@/lib/redis'
import { logError, logMessage, logWarn } from '@/lib/logging'
import { deleteFile } from '@/lib/storage'
import sharp from 'sharp'

export const CONTENT_VIOLATION_MESSAGE = '您发布的内容含违规信息，请修改后重试'
export const CONTENT_SECURITY_ERROR = '内容安全检测失败，请稍后重试'
const MEDIA_CHECK_REDIS_PREFIX = 'wechat:media_check:'
const MEDIA_CHECK_TTL_SECONDS = 40 * 60

export interface WechatContentCheckResult {
  passed: boolean
  skipped?: boolean
  error?: string
}

/** 获取用户绑定的小程序 openid，仅小程序用户参与文本安全检测。 */
export async function findWechatMiniOpenid(userId?: string | null): Promise<string | null> {
  if (!userId) return null
  const identity = await prisma.wechatIdentity.findFirst({
    where: { userId, platform: 'MINI_PROGRAM' },
    select: { openId: true },
    orderBy: { createdAt: 'asc' },
  })
  return identity?.openId || null
}

/**
 * 微信同步图片内容安全检测。
 * 支持 jpg/jpeg/png/bmp/gif，图片不大于 1MB。
 */
export async function checkWechatImage(
  buffer: Buffer,
  contentType: string,
): Promise<WechatContentCheckResult> {
  if (!isWechatMiniConfigured()) {
    logWarn('Wechat content security is not configured')
    return { passed: false, error: CONTENT_SECURITY_ERROR }
  }

  try {
    let imageBuffer = buffer
    let imageContentType = contentType
    if (imageContentType === 'image/webp') {
      imageBuffer = await sharp(imageBuffer)
        .rotate()
        .jpeg({ quality: 88 })
        .toBuffer()
      imageContentType = 'image/jpeg'
    }

    const accessToken = await getWechatMiniAccessToken()
    const ext = imageContentType.split('/')[1] || 'jpg'
    const form = new FormData()
    const arrayBuffer = imageBuffer.buffer.slice(
      imageBuffer.byteOffset,
      imageBuffer.byteOffset + imageBuffer.byteLength,
    ) as ArrayBuffer
    form.append('media', new Blob([arrayBuffer], { type: imageContentType }), `avatar.${ext}`)

    const response = await fetch(
      `https://api.weixin.qq.com/wxa/img_sec_check?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: 'POST',
        body: form,
        cache: 'no-store',
      },
    )
    const data = (await response.json().catch(() => ({}))) as {
      errcode?: number
      errmsg?: string
      result?: { suggest?: string }
    }

    if (data.errcode === 87014 || data.result?.suggest === 'risky') {
      return { passed: false, error: CONTENT_VIOLATION_MESSAGE }
    }
    if (data.errcode && data.errcode !== 0) {
      logWarn('Wechat img_sec_check failed:', data.errcode, data.errmsg)
      return { passed: false, error: CONTENT_SECURITY_ERROR }
    }
    return { passed: true }
  } catch (error) {
    logError('Wechat image security check failed:', error)
    return { passed: false, error: CONTENT_SECURITY_ERROR }
  }
}

/**
 * 微信文本内容安全检测（v2）。
 * 仅在小程序用户有 openid 时调用；网站手机号/密码用户不参与小程序内容安全。
 */
export async function checkWechatText(
  text: string | null | undefined,
  options: { userId?: string | null; scene?: 1 | 2 | 3 | 4 },
): Promise<WechatContentCheckResult> {
  const content = typeof text === 'string' ? text.trim() : ''
  if (!content) return { passed: true, skipped: true }

  if (!isWechatMiniConfigured()) {
    logWarn('Wechat content security is not configured')
    return { passed: false, error: CONTENT_SECURITY_ERROR }
  }

  const openid = await findWechatMiniOpenid(options.userId)
  if (!openid) return { passed: true, skipped: true }

  try {
    const accessToken = await getWechatMiniAccessToken()
    const response = await fetch(
      `https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          content,
          version: 2,
          scene: options.scene || 2,
          openid,
        }),
        cache: 'no-store',
      },
    )
    const data = (await response.json().catch(() => ({}))) as {
      errcode?: number
      errmsg?: string
      result?: { suggest?: string }
    }

    if (data.errcode === 87014 || data.result?.suggest === 'risky') {
      return { passed: false, error: CONTENT_VIOLATION_MESSAGE }
    }
    if (data.errcode && data.errcode !== 0) {
      logWarn('Wechat msg_sec_check failed:', data.errcode, data.errmsg)
      return { passed: false, error: CONTENT_SECURITY_ERROR }
    }
    return { passed: true }
  } catch (error) {
    logError('Wechat text security check failed:', error)
    return { passed: false, error: CONTENT_SECURITY_ERROR }
  }
}

/**
 * 提交微信官方异步多媒体检测。
 * 检测结果通过 wxa_media_check 事件推送到 /api/wechat/media-check-callback。
 */
export async function submitWechatMediaCheck(params: {
  userId: string
  mediaUrl: string
  scene?: 1 | 2 | 3 | 4
  key: string
  avatarUrl: string
}): Promise<{ submitted: boolean; traceId?: string; skipped?: boolean; error?: string }> {
  if (!isWechatMiniConfigured()) return { submitted: false, skipped: true }
  const openid = await findWechatMiniOpenid(params.userId)
  if (!openid) return { submitted: false, skipped: true }

  try {
    const accessToken = await getWechatMiniAccessToken()
    const response = await fetch(
      `https://api.weixin.qq.com/wxa/media_check_async?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          media_url: params.mediaUrl,
          media_type: 2,
          version: 2,
          scene: params.scene || 1,
          openid,
        }),
        cache: 'no-store',
      },
    )
    const data = (await response.json().catch(() => ({}))) as {
      errcode?: number
      errmsg?: string
      trace_id?: string
    }

    if (data.errcode && data.errcode !== 0) {
      logWarn('Wechat media_check_async failed:', data.errcode, data.errmsg)
      return { submitted: false, error: CONTENT_SECURITY_ERROR }
    }
    if (!data.trace_id) {
      logWarn('Wechat media_check_async did not return trace_id')
      return { submitted: false, error: CONTENT_SECURITY_ERROR }
    }

    const redis = getRedis()
    await redis.setex(
      `${MEDIA_CHECK_REDIS_PREFIX}${data.trace_id}`,
      MEDIA_CHECK_TTL_SECONDS,
      JSON.stringify({
        userId: params.userId,
        key: params.key,
        avatarUrl: params.avatarUrl,
        mediaUrl: params.mediaUrl,
        createdAt: Date.now(),
      }),
    )
    return { submitted: true, traceId: data.trace_id }
  } catch (error) {
    logError('Wechat media_check_async request failed:', error)
    return { submitted: false, error: CONTENT_SECURITY_ERROR }
  }
}

/** 处理 wxa_media_check 异步回调，命中违规时删除头像文件并清空头像。 */
export async function handleWechatMediaCheckCallback(params: {
  traceId: string
  errcode?: number
  suggest?: string
  isrisky?: number
}): Promise<void> {
  const redis = getRedis()
  const raw = await redis.get(`${MEDIA_CHECK_REDIS_PREFIX}${params.traceId}`)
  if (!raw) return

  await redis.del(`${MEDIA_CHECK_REDIS_PREFIX}${params.traceId}`)

  const risky =
    params.suggest === 'risky' ||
    params.isrisky === 1 ||
    params.errcode === 87014

  let record: { userId: string; key: string; avatarUrl: string } | null = null
  try {
    record = JSON.parse(raw) as { userId: string; key: string; avatarUrl: string }
  } catch {
    return
  }
  if (!record) return

  if (!risky) {
    logMessage(`Wechat media check passed for trace ${params.traceId}`)
    return
  }

  logWarn(`Wechat media check flagged avatar as risky for trace ${params.traceId}`)
  await deleteFile(record.key).catch(() => {})

  const currentUser = await prisma.user.findUnique({
    where: { id: record.userId },
    select: { avatarUrl: true },
  })
  if (currentUser?.avatarUrl === record.avatarUrl) {
    await prisma.user.update({
      where: { id: record.userId },
      data: { avatarUrl: null },
    })
  }
}
