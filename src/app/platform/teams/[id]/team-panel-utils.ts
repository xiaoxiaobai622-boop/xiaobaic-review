'use client'

import { getPlatformAccessToken } from '@/lib/platform-token-store'
import { formatBeijingDateTime, formatFileSize } from '@/lib/utils'
import type { LastActiveValue, Risk, TeamQuotaView } from '@/lib/platform-team-360'

export function authHeaders(json = false): Record<string, string> {
  const token = getPlatformAccessToken()
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

export async function platformJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { ...authHeaders(Boolean(init?.body)), ...(init?.headers || {}) },
    cache: 'no-store',
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`)
  return body as T
}

export function sourceLabel(source: LastActiveValue['source'] | string | null | undefined): string {
  if (source === 'member' || source === 'heartbeat') return '成员心跳'
  if (source === 'content') return '内容事件'
  if (source === 'client') return '客户访问'
  return ''
}

export function lastActiveText(value: LastActiveValue | null | undefined): string {
  if (!value?.at) return '未记录'
  return formatBeijingDateTime(value.at)
}

export function riskClass(tone: Risk['tone']): string {
  if (tone === 'danger') return 'bg-destructive/10 text-destructive'
  if (tone === 'warning') return 'bg-warning/10 text-warning'
  return 'bg-muted text-muted-foreground'
}

export function percentLabel(value: number | null): string {
  if (value === null) return '不限'
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`
}

export function limitLabel(value: number): string {
  return value > 0 ? String(value) : '不限'
}

export function quotaStorageLabel(quota: TeamQuotaView): string {
  return quota.maxStorageGB > 0 ? formatFileSize(quota.maxStorageGB * 1024 * 1024 * 1024) : '不限'
}

export function usagePercent(used: number, limit: number): number | null {
  if (limit <= 0) return null
  return (used / limit) * 100
}

export function statusLabel(status: string): string {
  if (status === 'IN_REVIEW') return '审片中'
  if (status === 'APPROVED') return '已通过'
  if (status === 'SHARE_ONLY') return '仅分享'
  if (status === 'ARCHIVED') return '已归档'
  return status
}

export function linkStatusLabel(status: string): string {
  if (status === 'ACTIVE') return '有效'
  if (status === 'EXPIRED') return '已过期'
  if (status === 'REVOKED') return '已撤销'
  return status
}

export function linkStatusClass(status: string): string {
  if (status === 'ACTIVE') return 'bg-success-visible text-success'
  if (status === 'EXPIRED') return 'bg-warning/10 text-warning'
  return 'bg-destructive/10 text-destructive'
}

export function roleLabel(role: string): string {
  if (role === 'OWNER') return '负责人'
  if (role === 'ADMIN') return '管理员'
  if (role === 'MEMBER') return '成员'
  return role
}

export function permissionLabel(permission: string): string {
  if (permission === 'view') return '查看'
  if (permission === 'comment') return '批注'
  if (permission === 'download') return '下载'
  if (permission === 'upload') return '上传'
  if (permission === 'approve') return '批准'
  return permission
}

export function typeLabel(type: string): string {
  if (type === 'REVIEW') return '审阅'
  if (type === 'DELIVERY') return '交付'
  if (type === 'COLLECT') return '收录'
  return type
}

export function scopeLabel(scope: string): string {
  if (scope === 'PROJECT') return '项目'
  if (scope === 'FOLDER') return '文件夹'
  if (scope === 'VIDEO') return '视频'
  if (scope === 'VIDEO_VERSION') return '视频版本'
  return scope
}

export function authModeLabel(mode: string): string {
  if (mode === 'NONE') return '无验证'
  if (mode === 'PASSWORD') return '密码'
  if (mode === 'OTP') return '邮箱验证码'
  if (mode === 'BOTH') return '密码 + 验证码'
  return mode
}
