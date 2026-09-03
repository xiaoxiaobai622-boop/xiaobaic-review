import { createHash, randomBytes } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformAuth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { MONTHLY_QUOTA } from '@/lib/platform-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function hashCardCode(code: string) {
  return createHash('sha256').update(code).digest('hex')
}

function createCardCode() {
  const raw = randomBytes(10).toString('hex').toUpperCase()
  return `VB-${raw.slice(0, 5)}-${raw.slice(5, 10)}-${raw.slice(10, 15)}-${raw.slice(15)}`
}

export async function GET(request: NextRequest) {
  const user = await requirePlatformAuth(request)
  if (user instanceof Response) return user

  const cards = await prisma.teamActivationCard.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true,
      codeLast4: true,
      planKey: true,
      durationDays: true,
      maxMembers: true,
      maxStorageGB: true,
      status: true,
      redeemedAt: true,
      redeemedByTeamId: true,
      createdAt: true,
    },
  })
  return NextResponse.json({ cards })
}

export async function POST(request: NextRequest) {
  const user = await requirePlatformAuth(request)
  if (user instanceof Response) return user

  const body = await request.json().catch(() => null)
  const requestedQuantity = Number(body?.quantity ?? 1)
  const quantity = Number.isInteger(requestedQuantity) ? Math.min(Math.max(requestedQuantity, 1), 100) : 1
  const created: Array<{ id: string; code: string; codeLast4: string }> = []

  for (let index = 0; index < quantity; index += 1) {
    const code = createCardCode()
    const card = await prisma.teamActivationCard.create({
      data: {
        codeHash: hashCardCode(code),
        codeLast4: code.slice(-4),
        planKey: 'MONTHLY',
        durationDays: 30,
        ...MONTHLY_QUOTA,
      },
      select: { id: true, codeLast4: true },
    })
    created.push({ id: card.id, code, codeLast4: card.codeLast4 })
  }

  return NextResponse.json({ cards: created }, { status: 201 })
}
