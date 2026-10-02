import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requirePlatformAdmin } from '@/lib/auth'
import { initStorage, uploadFile, deleteFile } from '@/lib/storage'
import { validateRequest, safeParseBodyTolerant } from '@/lib/validation'
import { getTransferConfig } from '@/lib/settings'
import { logError } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// 对象键与 Content-Type 都跟着字节里的真实格式走，而不是浏览器声明的 MIME：File.type 是客户端给的，
// 一张名叫 x.png 的 JPEG 会产出 .png 键、让读接口把 image/jpeg 的字节标成 image/png 发出去；
// 反过来一张货真价实的 PNG 只要 file.type 是空串就会被 MIME 白名单误拒。
// 这张表是「真实格式 → 键后缀 + Content-Type」的唯一口径，两个值必须一起出，不给它们分家的机会。
const QR_KEY = 'branding/transfer-qr'
type QrFormat = { extension: string; contentType: string }
const QR_FORMATS: Record<'png' | 'jpeg', QrFormat> = {
  png: { extension: '.png', contentType: 'image/png' },
  jpeg: { extension: '.jpg', contentType: 'image/jpeg' },
}
const MAX_QR_BYTES = 2 * 1024 * 1024

// PNG 的签名是固定的头 8 字节；JPEG 是 FF D8 再加下一个标记段的开头（FF）。
// 只认签名的开头就足够把这两类分开：真正的解码交给浏览器，这里只决定「存进哪个键、标成哪种类型」。
function sniffQrFormat(buffer: Buffer): QrFormat | null {
  const isPng =
    buffer.length >= 8 &&
    buffer.readUInt32BE(0) === 0x89504e47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  if (isPng) return QR_FORMATS.png
  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  if (isJpeg) return QR_FORMATS.jpeg
  return null
}

const transferSchema = z.object({
  accountName: z.string().trim().max(80).nullish(),
  accountNo: z.string().trim().max(64).nullish(),
  bank: z.string().trim().max(80).nullish(),
  note: z.string().max(2000).nullish(),
})

export async function GET(request: NextRequest) {
  const auth = await requirePlatformAdmin(request)
  if (auth instanceof Response) return auth
  const config = await getTransferConfig()
  return NextResponse.json({ ...config, qrUrl: config.qrPath ? `/api/settings/transfer/qr` : null })
}

export async function PATCH(request: NextRequest) {
  const auth = await requirePlatformAdmin(request)
  if (auth instanceof Response) return auth
  const parsed = await safeParseBodyTolerant(request)
  if (!parsed.success) return parsed.response
  const validation = validateRequest(transferSchema, parsed.data)
  if (!validation.success) {
    return NextResponse.json({ error: validation.error, details: validation.details }, { status: 400 })
  }
  const { accountName, accountNo, bank, note } = validation.data

  // 账号要留空格以外的一切：企业网银账号里出现空格是常见输入习惯，
  // 但带空格的账号抄进转账界面会被银行拒。undefined/null 原样透传（下面区分「没发」与「发 null」）。
  const normalizedNo = typeof accountNo === 'string' ? accountNo.replace(/\s+/g, '') : accountNo
  if (normalizedNo && !/^[0-9A-Za-z-]{6,64}$/.test(normalizedNo)) {
    return NextResponse.json({ error: '收款账号只能包含数字、字母和连字符' }, { status: 400 })
  }

  // 只写请求体里真的出现过的键：zod 对缺席的 nullish 输入键不给输出属性，所以 `!== undefined`
  // 就是「这次没提到这一项」。这是一条 PATCH 不是 PUT —— 缺席就留原值，显式 null 或空串才清空。
  // 那五列是运营唯一的一份收款配置，被一次半截请求抹掉等于全站客户当场无法下单；界面四个键全发，
  // 所以这条只挡住误用和未来的局部调用。
  const fields: {
    transferAccountName?: string | null
    transferAccountNo?: string | null
    transferBank?: string | null
    transferNote?: string | null
  } = {}
  if (accountName !== undefined) fields.transferAccountName = accountName?.trim() || null
  if (normalizedNo !== undefined) fields.transferAccountNo = normalizedNo || null
  if (bank !== undefined) fields.transferBank = bank?.trim() || null
  if (note !== undefined) fields.transferNote = note || null
  if (Object.keys(fields).length > 0) {
    await prisma.settings.upsert({
      where: { id: 'default' },
      update: fields,
      create: { id: 'default', ...fields },
    })
  }
  const config = await getTransferConfig()
  return NextResponse.json({ ...config, qrUrl: config.qrPath ? `/api/settings/transfer/qr` : null })
}

export async function POST(request: NextRequest) {
  const auth = await requirePlatformAdmin(request)
  if (auth instanceof Response) return auth
  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: '缺少图片' }, { status: 400 })
  if (file.size > MAX_QR_BYTES) {
    return NextResponse.json({ error: '收款码图片不得超过 2MB' }, { status: 400 })
  }
  const buffer = Buffer.from(await file.arrayBuffer())
  const format = sniffQrFormat(buffer)
  if (!format) {
    return NextResponse.json({ error: '收款码只支持 PNG 或 JPEG' }, { status: 400 })
  }
  const qrPath = `${QR_KEY}${format.extension}`
  // 先单独把库里当前指向的键读出来：它只服务后面的清理判断。跟上传塞进同一个 try 的话，一次
  // 读库抖动会被记成「upload failed」，把第一起真实事故带偏。读失败就直接中止而不是当作 null ——
  // 拿不准 previousPath 就往下走，同格式换码写库失败时会删掉正被客户看着的那张码。
  let previousPath: string | null = null
  try {
    previousPath =
      (await prisma.settings.findUnique({ where: { id: 'default' }, select: { transferQrPath: true } }))?.transferQrPath ?? null
  } catch (error) {
    logError('[SETTINGS:TRANSFER_QR] previous key read failed', error)
    return NextResponse.json({ error: '收款码保存失败，请重试' }, { status: 500 })
  }
  try {
    await initStorage()
    await uploadFile(qrPath, buffer, buffer.byteLength, format.contentType)
  } catch (error) {
    logError('[SETTINGS:TRANSFER_QR] upload failed', error)
    return NextResponse.json({ error: '收款码保存失败，请重试' }, { status: 500 })
  }
  try {
    await prisma.settings.upsert({
      where: { id: 'default' },
      update: { transferQrPath: qrPath },
      create: { id: 'default', transferQrPath: qrPath },
    })
  } catch (error) {
    // 写库失败就把刚上传的对象删掉：留着一个没人指向的文件，下次换码时既不会被覆盖也不会有人知道它存在。
    // 但同格式换码时它覆盖的正是当前生效的那张 —— 库里指的还是同一个键，删掉会让客户当场看到 404。
    if (qrPath !== previousPath) {
      await deleteFile(qrPath).catch((cleanup) => logError('[SETTINGS:TRANSFER_QR] orphan cleanup failed', cleanup))
    } else {
      // 这条分支故意留着新字节：代价是界面报「保存失败」而客户看到的码其实已经换了。
      // 不留一行日志的话，这个「报的状态和发的图不一致」永远查不出来。
      logError(`[SETTINGS:TRANSFER_QR] settings write failed, live key ${qrPath} bytes already replaced`, error)
    }
    logError('[SETTINGS:TRANSFER_QR] settings write failed', error)
    return NextResponse.json({ error: '收款码保存失败，请重试' }, { status: 500 })
  }
  // 换格式后旧键不再有人指向，顺手清掉；删失败只留一个孤儿对象，不影响新码生效。
  if (previousPath && previousPath !== qrPath) {
    await deleteFile(previousPath).catch((cleanup) => logError('[SETTINGS:TRANSFER_QR] previous qr cleanup failed', cleanup))
  }
  return NextResponse.json({ ok: true })
}
