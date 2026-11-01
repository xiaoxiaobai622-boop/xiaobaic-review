import { NextResponse } from 'next/server'
import { logError } from '@/lib/logging'
import { SupportError } from './service'

export function supportErrorResponse(error: unknown) {
  if (error instanceof SupportError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
  }
  logError('[SUPPORT] request failed:', error)
  return NextResponse.json({ error: '客服服务暂时不可用' }, { status: 500 })
}

export function parseAfterSeq(value: string | null) {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null
}

export function noStoreJson(data: unknown, init?: ResponseInit) {
  const response = NextResponse.json(data, init)
  response.headers.set('Cache-Control', 'no-store')
  return response
}
