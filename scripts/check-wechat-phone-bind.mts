import { readFileSync } from 'node:fs'
import { normalizePhone, phoneStoreFields, wherePhone } from '../src/lib/phone-field'

/**
 * 微信小程序「手机号快速验证组件」的接线判据（静态＋纯函数）。
 *
 * 背景：微信扫码/小程序建出来的账号没有手机号，而团队工作台的每一枚接口都过
 * `requireApiUser`，`user.phone` 为空一律 403 PHONE_REQUIRED。所以小程序那边授权了
 * 号码，服务端必须真的接住并落库（加密列 + phoneHash），不是只在界面上问一句。
 *
 * 换号码那一步要打微信接口，本地没法端到端跑（要真 AppID/Secret 与真 code），
 * 这里钉的是接线与落库口径；网络那一段的验收要在小程序里点一次授权。
 */

let passed = 0
const failures: string[] = []
const read = (path: string) => readFileSync(path, 'utf8')

function checkTrue(name: string, ok: boolean, detail = '') {
  if (ok) { passed += 1; return }
  failures.push(`${name}${detail ? ` → ${detail}` : ''}`)
}

const LIB = read('src/lib/wechat-mini-auth.ts')
const MINI = read('src/app/api/auth/wechat/mini/login/route.ts')
const MINI_PROGRAM = read('src/app/api/auth/wechat/miniprogram/login/route.ts')

console.log('=== 换号码：打的是哪个微信接口 ===')

checkTrue('W1 用「手机号快速验证」接口（wxa/business/getuserphonenumber），不是拿登录 code 当号码',
  LIB.includes('wxa/business/getuserphonenumber') && !/getuserphonenumber[\s\S]{0,80}js_code/.test(LIB),
  '→ 没看到 getuserphonenumber')
checkTrue('W1·b 号码从 phone_info 里取，purePhoneNumber 优先、phoneNumber 兜底',
  LIB.includes('phone_info?.purePhoneNumber') && LIB.includes('phone_info?.phoneNumber'))
checkTrue('W1·c 换号失败只记日志、返回 null（绑定失败不许把登录一起弄挂）',
  /export async function exchangeMiniProgramPhoneCode[\s\S]*?catch[\s\S]*?return null[\s\S]*?\n\}/.test(LIB)
  && LIB.includes('Wechat phone exchange failed'))

console.log('=== 落库：加密列 + 摘要，不写明文 ===')

const sample = '13800138000'
const stored = phoneStoreFields(sample)
checkTrue('W2 写库走 phoneStoreFields：phone 列不是明文、phoneHash 是 64 位摘要',
  Boolean(stored.phone) && stored.phone !== sample && Boolean(stored.phoneHash) && /^[0-9a-f]{64}$/.test(String(stored.phoneHash)),
  `→ ${JSON.stringify({ phoneIsPlain: stored.phone === sample, hashLen: String(stored.phoneHash).length })}`)
checkTrue('W2·b 同一个号归一化后能查回来（wherePhone 拿摘要做等值，不拿密文比）',
  Boolean(normalizePhone(` ${sample} `)) && JSON.stringify(wherePhone(sample)) === JSON.stringify({ phoneHash: stored.phoneHash }),
  `→ ${JSON.stringify(wherePhone(sample))}`)
checkTrue('W2·c 绑定函数用 phoneStoreFields 写、不用 data: { phone } 直接塞明文',
  /bindWechatPhone[\s\S]*?phoneStoreFields\(phone\)/.test(LIB))

console.log('=== 覆盖与冲突 ===')

checkTrue('W3 已经有号码的不覆盖（改号走个人中心那套双验证）',
  /bindWechatPhone[\s\S]*?if \(user\.phone\) return 'skipped'/.test(LIB))
checkTrue('W3·b 号码被别人占用时返回 conflict，由路由回 409 PHONE_ACCOUNT_CONFLICT',
  /bindWechatPhone[\s\S]*?findFirst\(\{[\s\S]*?NOT: \{ id: userId \}/.test(LIB)
  && (MINI.includes('PHONE_ACCOUNT_CONFLICT') && MINI_PROGRAM.includes('PHONE_ACCOUNT_CONFLICT')))
checkTrue('W3·c 冲突判断按 phoneHash 查（where 里含 wherePhone(phone)）',
  /bindWechatPhone[\s\S]*?wherePhone\(phone\)/.test(LIB))

console.log('=== 两条登录链都要收 phoneCode，且在发令牌之前绑 ===')

checkTrue('W4 miniprogram/login 解析 phoneCode，并在 issueAdminTokens 之前调用 bindWechatPhone',
  MINI_PROGRAM.includes("body?.phoneCode") &&
  MINI_PROGRAM.indexOf('bindWechatPhone(created.id, phoneCode)') > 0 &&
  MINI_PROGRAM.indexOf('bindWechatPhone(created.id, phoneCode)') < MINI_PROGRAM.indexOf('issueAdminTokens('))
checkTrue('W4·b miniprogram/login 的「绑定微信到已登录账号」那一支也顺手绑号（session.userId）',
  MINI_PROGRAM.includes('bindWechatPhone(session.userId, phoneCode)'))
checkTrue('W4·c mini/login（扫码确认那条）同样在发令牌前绑号',
  MINI.includes("safeText(body.phoneCode, 128)") &&
  MINI.indexOf('bindWechatPhone(created.id, phoneCode)') > 0 &&
  MINI.indexOf('bindWechatPhone(created.id, phoneCode)') < MINI.indexOf('issueAdminTokens('))
checkTrue('W4·d 绑成功后重新读一次库再发令牌（否则令牌里还是绑号前的 phone）',
  MINI_PROGRAM.includes('findUniqueOrThrow({ where: { id: created.id } })')
  && MINI.includes('findUniqueOrThrow({ where: { id: created.id } })'))
checkTrue('W4·e 响应里带 phoneBound，小程序能知道这次到底绑上没有',
  MINI_PROGRAM.includes('phoneBound,') && MINI.includes('phoneBound: true'))

console.log(`\n合计 ${passed} PASS / ${failures.length} FAIL`)
for (const f of failures) console.log(`  FAIL  ${f}`)
process.exit(failures.length === 0 ? 0 : 1)
