import { NextRequest, NextResponse } from 'next/server'
import { randomInt, randomBytes } from 'crypto'
import { prisma } from '@/lib/db'
import { getCurrentUserFromRequest } from '@/lib/auth'
import { getRedis } from '@/lib/redis'
import { verifyPassword } from '@/lib/encryption'
import { rateLimit } from '@/lib/rate-limit'
import { hashPhoneCode, PHONE_REGEX, sendPhoneCode } from '@/lib/phone-auth'
import { createPhoneOnlyEmail, isPhoneOnlyEmail } from '@/lib/user-contact'

export const runtime = 'nodejs'
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })
// Compare and consume in one operation: concurrent requests cannot reuse a code.
const consume = `local v=redis.call('GET',KEYS[1]); if not v then return 0 end; if v~=ARGV[1] then return -1 end; redis.call('DEL',KEYS[1]); return 1`
export async function POST(request: NextRequest) {
  try {
    const session = await getCurrentUserFromRequest(request)
    if (!session) return fail('请先登录', 401)
    const body = await request.json().catch(() => null)
    if (!body) return fail('请求格式错误')
    const { action } = body
    const limited = await rateLimit(request, { windowMs: 15 * 60 * 1000, maxRequests: 20, message: '操作过于频繁，请稍后再试' }, 'account-phone', session.id)
    if (limited) return limited
    const user = await prisma.user.findUnique({ where: { id: session.id }, select: { id: true, phone: true, password: true, email: true } })
    if (!user) return fail('账号不存在', 404)
    const redis = getRedis()
    const prefix = `account-phone:${user.id}:`
    const token = typeof body.token === 'string' && /^[a-f0-9]{48}$/.test(body.token) ? body.token : ''
    const grantKey = `${prefix}grant:${token}`
    const grantValue = JSON.stringify({ phone: user.phone })
    const checkCode = async (key: string, phone: string) => {
      if (typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) return false
      return Number(await redis.eval(consume, 1, key, hashPhoneCode(phone, body.code))) === 1
    }
    if (action === 'send-old' || action === 'send-new') {
      const phone = action === 'send-old' ? user.phone : body.phone
      if (typeof phone !== 'string' || !PHONE_REGEX.test(phone)) return fail('请输入有效手机号')
      if (action === 'send-new' && (!token || await redis.get(grantKey) !== grantValue)) return fail('身份验证已过期，请重新验证', 403)
      if (action === 'send-new' && phone === user.phone) return fail('新手机号不能与当前手机号相同')
      const cooldown = `${prefix}cooldown:${action}`
      if (!(await redis.set(cooldown, '1', 'EX', 60, 'NX'))) return fail('请等待 60 秒后重新发送', 429)
      const destinationLimit = await rateLimit(request, { windowMs: 60 * 60 * 1000, maxRequests: 5, message: '该号码发送过于频繁，请稍后再试' }, 'phone-change-send', phone)
      if (destinationLimit) return destinationLimit
      const code = String(randomInt(100000, 1000000))
      const key = action === 'send-old' ? `${prefix}old:${phone}` : `${prefix}new:${token}:${phone}`
      await redis.setex(key, 300, hashPhoneCode(phone, code))
      try {
        await sendPhoneCode(phone, code, { templateCode: process.env.ALIYUN_SMS_LOGIN_TEMPLATE_CODE || process.env.ALIYUN_SMS_TEMPLATE_CODE, min: 5 })
      } catch {
        await redis.del(key, cooldown)
        return fail('验证码发送失败，请稍后重试或使用密码验证', 502)
      }
      return NextResponse.json({ success: true })
    }
    if (action === 'verify') {
      const valid = body.method === 'password'
        ? typeof body.password === 'string' && await verifyPassword(body.password, user.password)
        : body.method === 'sms' && !!user.phone && await checkCode(`${prefix}old:${user.phone}`, user.phone)
      if (!valid) return fail('验证失败，请检查密码或验证码；验证码有效期为 5 分钟')
      const grant = randomBytes(24).toString('hex')
      await redis.setex(`${prefix}grant:${grant}`, 600, grantValue)
      return NextResponse.json({ token: grant })
    }
    if (action === 'confirm') {
      const phone = typeof body.phone === 'string' ? body.phone : ''
      if (!PHONE_REGEX.test(phone) || phone === user.phone) return fail('请输入与当前号码不同的有效手机号')
      if (!token || await redis.get(grantKey) !== grantValue) return fail('身份验证已过期，请重新验证', 403)
      if (!(await checkCode(`${prefix}new:${token}:${phone}`, phone))) return fail('验证码错误或已过期，请重新获取')
      if (await prisma.user.findUnique({ where: { phone }, select: { id: true } })) return fail('该手机号已绑定其他账号，请更换号码', 409)
      if (Number(await redis.eval(consume, 1, grantKey, grantValue)) !== 1) return fail('身份验证已过期，请重新验证', 403)
      const updated = await prisma.user.updateMany({
        where: { id: user.id, phone: user.phone },
        data: { phone, ...(isPhoneOnlyEmail(user.email) ? { email: createPhoneOnlyEmail(phone) } : {}) },
      })
      if (!updated.count) return fail('手机号已发生变化，请刷新页面重试', 409)
      return NextResponse.json({ phone })
    }
    return fail('不支持的操作')
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') return fail('该手机号已被使用', 409)
    return fail('暂时无法处理，请稍后重试', 500)
  }
}
