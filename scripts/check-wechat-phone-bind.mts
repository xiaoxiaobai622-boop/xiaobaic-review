import { readFileSync } from 'node:fs'
import { normalizePhone, phoneStoreFields, wherePhone } from '../src/lib/phone-field'

/**
 * 微信小程序「手机号快速验证组件」的接线判据（静态＋纯函数）。
 *
 * 背景：微信扫码/小程序建出来的账号没有手机号，而团队工作台的每一枚接口都过
 * `requireApiUser`，`user.phone` 为空一律 403 PHONE_REQUIRED。所以小程序那边授权了
 * 号码，服务端必须真的接住并落库（加密列 + phoneHash），不是只在界面上问一句。
 *
 * 10-24 起的规则是「手机号是账号主键」：登录模式必须先拿到手机号；号码已经属于
 * 另一个账号时，把微信占位账号合并进那个手机号账号，不再报「已绑定其他账号」。
 * 绑定模式（把微信挂到已登录账号）仍走 `bindWechatPhone` 的冲突检查。
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
const PHONE_LIB = read('src/lib/wechat-mini-phone.ts')
const MERGE_LIB = read('src/lib/wechat-account-merge.ts')
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

checkTrue('W3 绑定模式已有号码不覆盖（改号走个人中心那套双验证）',
  /bindWechatPhone[\s\S]*?if \(user\.phone\) return 'skipped'/.test(LIB))
checkTrue('W3·b 登录模式不再报冲突：号码已有账号时把微信占位账号合并进去，没手机号就不发登录态',
  MERGE_LIB.includes('phoneWhereOrNone(phone)')
  && MERGE_LIB.includes('mergeWechatUserIntoPhoneAccount')
  && MINI_PROGRAM.includes('needsPhone: true')
  && MINI.includes("code: 'PHONE_REQUIRED'"))
checkTrue('W3·c 合并前的查找按 phoneHash（不拿密文列做等值）',
  /findFirst\(\{ where: phoneWhereOrNone\(phone\) \}\)/.test(MERGE_LIB)
  && !/findUnique\(\{ where: \{ phone[,}]/.test(MERGE_LIB))
checkTrue('W3·d 合并要搬走 Restrict 外键（订单/订单事件），否则删占位号会失败',
  MERGE_LIB.includes('tx.order.updateMany')
  && MERGE_LIB.includes('tx.orderEvent.updateMany')
  && MERGE_LIB.includes('tx.platformFeedback.updateMany'))

console.log('=== 两条登录链都要收 phoneCode，且在发令牌之前绑/合并 ===')

checkTrue('W4 miniprogram/login 解析 phoneCode，并在 issueAdminTokens 之前绑/合并',
  MINI_PROGRAM.includes("body?.phoneCode") &&
  MINI_PROGRAM.indexOf('await bindPhoneToWechatUser(') > 0 &&
  MINI_PROGRAM.indexOf('await bindPhoneToWechatUser(') < MINI_PROGRAM.indexOf('issueAdminTokens('))
checkTrue('W4·b miniprogram/login 的「绑定微信到已登录账号」那一支仍走 bindWechatPhone(session.userId)',
  MINI_PROGRAM.includes('bindWechatPhone(session.userId, phoneCode)'))
checkTrue('W4·c mini/login（扫码确认那条）同样在发令牌前绑/合并',
  MINI.includes('safeText(body.phoneCode, 512)') &&
  MINI.indexOf('await bindPhoneToWechatUser(') > 0 &&
  MINI.indexOf('await bindPhoneToWechatUser(') < MINI.indexOf('issueAdminTokens('))
checkTrue('W4·d 合并/绑定返回的账号直接用来发令牌（不是拿占位账号的旧 id）',
  MINI_PROGRAM.includes('user = bound.user') && MINI.includes('adminUser = bound.user')
  && MINI_PROGRAM.indexOf('user = bound.user') < MINI_PROGRAM.indexOf('issueAdminTokens(')
  && MINI.indexOf('adminUser = bound.user') < MINI.indexOf('issueAdminTokens('))
checkTrue('W4·e 响应告诉小程序这次是否合并了账号；没有手机号就不发登录态',
  MINI_PROGRAM.includes('accountMerged: merged')
  && MINI_PROGRAM.includes('needsPhone: true')
  && MINI.includes("code: 'PHONE_REQUIRED'"))
checkTrue('W4·f 新号先换微信手机号接口，超时与错误码都接住，不把内部错误直接甩给用户',
  PHONE_LIB.includes('wxa/business/getuserphonenumber')
  && PHONE_LIB.includes('AbortSignal.timeout(10_000)')
  && PHONE_LIB.includes('PHONE_CODE_INVALID')
  && MINI_PROGRAM.includes('PHONE_UNSUPPORTED_REGION')
  && MINI.includes('PHONE_UNSUPPORTED_REGION'))

console.log(`\n合计 ${passed} PASS / ${failures.length} FAIL`)
for (const f of failures) console.log(`  FAIL  ${f}`)
process.exit(failures.length === 0 ? 0 : 1)
