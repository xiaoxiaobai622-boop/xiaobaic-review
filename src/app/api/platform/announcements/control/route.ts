import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAuth } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { getAnnouncementControl } from '@/lib/announcements/control'
import { recordAnnouncementAudit } from '@/lib/announcements/audit'
import { prisma } from '@/lib/db'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function toResponse(control: Awaited<ReturnType<typeof getAnnouncementControl>>) {
  return {
    control: {
      bannerModalPaused: control.bannerModalPaused,
      modalMaxPerDay: control.modalMaxPerDay,
      modalCooldownMinutes: control.modalCooldownMinutes,
      modalMaxShowsPerUser: control.modalMaxShowsPerUser,
      toastMaxPriority: control.toastMaxPriority,
    },
    updatedAt: control.updatedAt,
    updatedByLabel: control.updatedByLabel,
  }
}

/** GET /api/platform/announcements/control — kill switch + modal frequency config. */
export async function GET(request: NextRequest) {
  const platformAuth = await requirePlatformAuth(request)
  if (platformAuth instanceof Response) return platformAuth

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: '请求过于频繁，请稍后再试',
  }, 'platform-announcement-control-get')
  if (limited) return limited

  try {
    return NextResponse.json(toResponse(await getAnnouncementControl()))
  } catch (error) {
    logError('[ANNOUNCEMENT CONTROL] read failed:', error)
    return NextResponse.json({ error: '公告控制配置读取失败' }, { status: 500 })
  }
}

/** PATCH /api/platform/announcements/control — audited kill switch / limits. */
export async function PATCH(request: NextRequest) {
  const platformAuth = await requirePlatformAuth(request)
  if (platformAuth instanceof Response) return platformAuth

  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 10,
    message: '操作过于频繁，请稍后再试',
  }, 'platform-announcement-control-patch')
  if (limited) return limited

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: '请求内容不合法' }, { status: 400 })
  }

  const errors: string[] = []
  const data: {
    bannerModalPaused?: boolean
    modalMaxPerDay?: number
    modalCooldownMinutes?: number
    modalMaxShowsPerUser?: number
    toastMaxPriority?: number
  } = {}

  if (body.bannerModalPaused !== undefined) {
    if (typeof body.bannerModalPaused !== 'boolean') errors.push('kill switch 必须是布尔值')
    else data.bannerModalPaused = body.bannerModalPaused
  }

  const integerFields: Array<{
    key: 'modalMaxPerDay' | 'modalCooldownMinutes' | 'modalMaxShowsPerUser' | 'toastMaxPriority'
    min: number
    max: number
    label: string
  }> = [
    { key: 'modalMaxPerDay', min: 0, max: 10, label: '每日弹窗上限' },
    { key: 'modalCooldownMinutes', min: 0, max: 10080, label: '单条冷却分钟数' },
    { key: 'modalMaxShowsPerUser', min: 0, max: 50, label: '单用户最多展示次数' },
    { key: 'toastMaxPriority', min: 0, max: 100, label: '轻提示最高优先级' },
  ]
  for (const field of integerFields) {
    if (body[field.key] === undefined) continue
    const value = Number(body[field.key])
    if (!Number.isInteger(value) || value < field.min || value > field.max) {
      errors.push(`${field.label}必须是 ${field.min}–${field.max} 的整数`)
    } else {
      data[field.key] = value
    }
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join('；'), details: errors }, { status: 400 })
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: '没有需要更新的配置' }, { status: 400 })
  }

  try {
    const before = await getAnnouncementControl()
    const updated = await prisma.announcementControl.update({
      where: { id: 'global' },
      data: {
        ...data,
        updatedBy: platformAuth.id,
        updatedByLabel: platformAuth.name || platformAuth.email,
      },
    })

    const killSwitchChanged = data.bannerModalPaused !== undefined
      && before.bannerModalPaused !== updated.bannerModalPaused
    await recordAnnouncementAudit({
      announcementId: null,
      actor: platformAuth,
      action: killSwitchChanged ? 'KILL_SWITCH' : 'CONTROL_UPDATE',
      detail: {
        ...(killSwitchChanged ? { paused: updated.bannerModalPaused } : {}),
        fields: Object.keys(data),
      },
    })

    return NextResponse.json(toResponse(updated))
  } catch (error) {
    logError('[ANNOUNCEMENT CONTROL] update failed:', error)
    return NextResponse.json({ error: '公告控制配置更新失败' }, { status: 500 })
  }
}
