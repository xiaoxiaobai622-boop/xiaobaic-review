import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requirePlatformAuth } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { noStoreJson, supportErrorResponse } from '@/lib/support/http'
import { getSupportSettings, supportPublicSettings } from '@/lib/support/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = await requirePlatformAuth(request)
  if (auth instanceof Response) return auth
  try {
    const settings = await getSupportSettings()
    return noStoreJson({
      settings: {
        ...supportPublicSettings(settings),
        quietHours: settings.quietHours,
        retentionDays: settings.retentionDays,
      },
    })
  } catch (error) {
    return supportErrorResponse(error)
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePlatformAuth(request)
  if (auth instanceof Response) return auth
  const limited = await rateLimit(request, {
    windowMs: 60 * 1000,
    maxRequests: 30,
    message: '操作过于频繁',
  }, 'platform-support-settings', auth.id)
  if (limited) return limited

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const data: Prisma.SupportSettingsUpdateInput = {}
    const metadata: Record<string, unknown> = {}

    if (body.enabled === true || body.enabled === false) {
      data.enabled = body.enabled
      metadata.enabled = body.enabled
    }
    if (typeof body.firstResponseTargetMinutes === 'number' && body.firstResponseTargetMinutes >= 1 && body.firstResponseTargetMinutes <= 1440) {
      const value = Math.floor(body.firstResponseTargetMinutes)
      data.firstResponseTargetMinutes = value
      metadata.firstResponseTargetMinutes = value
    }
    if (typeof body.retentionDays === 'number' && body.retentionDays >= 30 && body.retentionDays <= 3650) {
      const value = Math.floor(body.retentionDays)
      data.retentionDays = value
      metadata.retentionDays = value
    }
    if (body.csatEnabled === true || body.csatEnabled === false) {
      data.csatEnabled = body.csatEnabled
      metadata.csatEnabled = body.csatEnabled
    }
    if (body.businessHours && typeof body.businessHours === 'object' && !Array.isArray(body.businessHours)) {
      data.businessHours = body.businessHours as Prisma.InputJsonValue
      metadata.businessHours = true
    }
    if (body.offlineMessage && typeof body.offlineMessage === 'object' && !Array.isArray(body.offlineMessage)) {
      data.offlineMessage = body.offlineMessage as Prisma.InputJsonValue
      metadata.offlineMessage = true
    }
    if (body.fallbackContacts && typeof body.fallbackContacts === 'object' && !Array.isArray(body.fallbackContacts)) {
      data.fallbackContacts = body.fallbackContacts as Prisma.InputJsonValue
      metadata.fallbackContacts = true
    }
    if (body.quietHours && typeof body.quietHours === 'object' && !Array.isArray(body.quietHours)) {
      data.quietHours = body.quietHours as Prisma.InputJsonValue
      metadata.quietHours = true
    }

    if (Object.keys(data).length === 0) {
      return noStoreJson({ error: '没有可更新的设置' }, { status: 400 })
    }

    await getSupportSettings()
    await prisma.$transaction(async (tx) => {
      await tx.supportSettings.update({
        where: { id: 'default' },
        data,
      })
      await tx.supportEvent.create({
        data: {
          actorType: 'AGENT',
          actorId: auth.id,
          type: 'SUPPORT_SETTINGS_UPDATED',
          metadata: metadata as Prisma.InputJsonValue,
        },
      })
    })

    const settings = await getSupportSettings()
    return noStoreJson({
      settings: {
        ...supportPublicSettings(settings),
        quietHours: settings.quietHours,
        retentionDays: settings.retentionDays,
      },
    })
  } catch (error) {
    return supportErrorResponse(error)
  }
}
