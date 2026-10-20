/**
 * 播放界面那枚「时间格式」切换的判据（纯函数那半，进 CI）。
 *
 * 现场事实：三档的显示口径以前散在 4 个组件里各抄一份（`CustomVideoControls` 里那份额过的
 * `formatTime` 在 60 分钟以上会画成 `61:40`），而选哪一档由项目/团队那列
 * `timestampDisplay` 决定——它 NOT NULL DEFAULT 'TIMECODE'，实测全库没人真配过它（项目级那枚
 * 控件 10-03 就被删了），于是所有人一进来都是时间码。他 10-19 点的名：默认要是**标准**。
 *
 * 所以这一档从此归**看的人**：本机选过的算，没选过就是标准。这里钉住三档各自的形状、
 * 边界值不许画成 NaN、取不到 fps 的兜底口径、以及"默认＝标准"这条本身。
 */
import { readFileSync } from 'node:fs'
import {
  DEFAULT_TIME_FORMAT,
  TIME_FORMATS,
  TIME_FORMAT_STORAGE_KEY,
  formatTimeDisplay,
  formatTimecodeAs,
  isTimeFormat,
  normalizeStoredTimeFormat,
} from '../src/lib/time-format'

let passed = 0
const failures: string[] = []

function check(name: string, got: string, want: string, note = '') {
  if (got === want) { passed += 1; return }
  failures.push(`${name}\n      期望 ${JSON.stringify(want)}，实得 ${JSON.stringify(got)}${note ? `\n      ${note}` : ''}`)
}

function checkTrue(name: string, ok: boolean, detail = '') {
  if (ok) { passed += 1; return }
  failures.push(`${name}${detail ? ` → ${detail}` : ''}`)
}

console.log('=== 三档各自的形状 ===')

check('F1 标准：3 分 7 秒', formatTimeDisplay(187, 25, 187, 'STANDARD'), '03:07')
check('F2 标准：一小时以上要带时（不是 61:40 那种）', formatTimeDisplay(3723, 25, 3723, 'STANDARD'), '01:02:03')
check('F2·b 标准：整条片子超过一小时，当前读数也带时（两列对齐，不许 03:07 / 1:02:03 混着）',
  formatTimeDisplay(187, 25, 3723, 'STANDARD'), '00:03:07')
check('F3 时间码：25fps 的 1.5 秒落在第 12 帧（不许四舍五入到下一帧）',
  formatTimeDisplay(1.5, 25, 60, 'TIMECODE'), '00:00:01:12')
check('F4 时间码：29.97 走丢帧，第 1800 帧显示成 ;02（;00 ;01 是被跳掉的那两帧）',
  formatTimeDisplay(1800 / 29.97, 29.97, 3600, 'TIMECODE'), '00:01:00;02')
check('F4·b 时间码：丢帧档的上一帧还是 59 分满',
  formatTimeDisplay(1799 / 29.97, 29.97, 3600, 'TIMECODE'), '00:00:59;29')
check('F5 帧：25fps 的 3 秒 = 75 帧', formatTimeDisplay(3, 25, 60, 'FRAMES'), '75')
check('F6 帧：时长读数走同一档（90 秒 @25）', formatTimeDisplay(90, 25, 90, 'FRAMES'), '2250')

console.log('=== 边界与非有限值：不许把 NaN 画到界面上 ===')

for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
  check(`F7 秒数是 ${bad} ⇒ 标准档画自己的零`, formatTimeDisplay(bad, 25, 60, 'STANDARD'), '00:00')
  check(`F7·b 秒数是 ${bad} ⇒ 时间码档画自己的零`, formatTimeDisplay(bad, 25, 60, 'TIMECODE'), '00:00:00:00')
  check(`F7·c 秒数是 ${bad} ⇒ 帧档画自己的零`, formatTimeDisplay(bad, 25, 60, 'FRAMES'), '0')
}

check('F8 取不到 fps（null）⇒ 按 24 兜底，和评论、邮件那几处同口径',
  formatTimeDisplay(1, null, 60, 'TIMECODE'), '00:00:01:00')
check('F8·b fps = 0 ⇒ 同样按 24', formatTimeDisplay(1, 0, 60, 'TIMECODE'), '00:00:01:00')
check('F8·c fps 是 NaN ⇒ 同样按 24', formatTimeDisplay(1.5, Number.NaN, 60, 'FRAMES'), '36')
check('F9 时长取不到 ⇒ 标准档按秒数自己决定要不要带时',
  formatTimeDisplay(3723, 25, null, 'STANDARD'), '01:02:03')

console.log('=== 库里存的是时间码，反过来画三档 ===')

check('F10 时间码档：原样显示存进来的那串（不来回换算，免得丢帧档被换算毁掉）',
  formatTimecodeAs('00:01:00;02', 29.97, 3600, 'TIMECODE'), '00:01:00;02')
check('F11 帧档：00:00:03:12 @25 = 87 帧', formatTimecodeAs('00:00:03:12', 25, 60, 'FRAMES'), '87')
check('F12 标准档：同一条 = 00:03', formatTimecodeAs('00:00:03:12', 25, 60, 'STANDARD'), '00:03')
check('F12·b 时间码串读坏了（服务端给了脏值）⇒ 画零，不画 undefined',
  formatTimecodeAs('不是时间码', 25, 60, 'STANDARD'), '00:00')

console.log('=== 默认档与本机存的值 ===')

checkTrue('F13 默认档＝标准（他点的名，不再是时间码）', DEFAULT_TIME_FORMAT === 'STANDARD',
  `→ 实得 ${DEFAULT_TIME_FORMAT}`)
checkTrue('F14 菜单顺序＝帧、标准、时间码', TIME_FORMATS.join(',') === 'FRAMES,STANDARD,TIMECODE',
  `→ 实得 ${TIME_FORMATS.join(',')}`)
checkTrue('F15 认不出的存值（旧数据／手改过 localStorage）⇒ 回落默认，不画 NaN',
  normalizeStoredTimeFormat('TIMECODE_EVER') === 'STANDARD' && normalizeStoredTimeFormat(null) === 'STANDARD',
  `→ 实得 ${normalizeStoredTimeFormat('TIMECODE_EVER')}/${normalizeStoredTimeFormat(null)}`)
checkTrue('F15·b 三档自己都要认得', TIME_FORMATS.every((f) => isTimeFormat(f) && normalizeStoredTimeFormat(f) === f))
checkTrue('F16 localStorage 键名钉住（改名＝所有人丢掉自己选过的档）',
  TIME_FORMAT_STORAGE_KEY === 'time_format', `→ 实得 ${TIME_FORMAT_STORAGE_KEY}`)

console.log('=== 那两处「默认时间码格式」控件已拆（10-19 他点单）===')

const TEAM_PAGE = 'src/app/studio/team/settings/page.tsx'
const PLATFORM_SECTION = 'src/components/settings/ProjectDefaultsSection.tsx'
const surfaces = { [TEAM_PAGE]: readFileSync(TEAM_PAGE, 'utf8'), [PLATFORM_SECTION]: readFileSync(PLATFORM_SECTION, 'utf8') }
const stillThere = Object.entries(surfaces).filter(([, src]) => /defaultTimestampDisplay|默认时间码格式/.test(src)).map(([f]) => f)
checkTrue('S1 两处设置界面都不再画这枚控件（读数既然不看那两列，留着就是骗人：改了下拉什么都没发生）',
  stillThere.length === 0, `→ 还在的：${JSON.stringify(stillThere)}`)

const orphanKeys = ['timestampDisplay', 'timecode', 'simpleTime', 'timestampHint']
const leftKeys = ['zh', 'en', 'nl', 'de'].filter((lang) => {
  const block = JSON.parse(readFileSync(`src/locales/${lang}.json`, 'utf8')).platformSettings?.videoProcessing
    ?? JSON.parse(readFileSync(`src/locales/${lang}.json`, 'utf8')).videoProcessing
  return Boolean(block) && orphanKeys.some((k) => k in block)
})
checkTrue('S2 四语言里那四枚 key 跟着删净（只删控件不删文案＝下一轮孤儿 key 判据又要红）',
  leftKeys.length === 0, `→ 还留着的语言：${JSON.stringify(leftKeys)}`)

const schema = readFileSync('prisma/schema.prisma', 'utf8')
const teamApi = readFileSync('src/app/api/team-settings/route.ts', 'utf8')
const settingsApi = readFileSync('src/app/api/settings/route.ts', 'utf8')
checkTrue('S2·b 两列与写入链刻意留着（和 10-03 那批「控件拆掉、列与读取链留着」同口径，别当死代码顺手删）',
  schema.includes('defaultTimestampDisplay') && schema.includes('timestampDisplay String')
    && teamApi.includes('defaultTimestampDisplay') && settingsApi.includes('defaultTimestampDisplay'),
  `→ schema 两列 ${schema.includes('defaultTimestampDisplay') && schema.includes('timestampDisplay String')}，`
  + `接口仍认这个字段 ${teamApi.includes('defaultTimestampDisplay') && settingsApi.includes('defaultTimestampDisplay')}`)

const screens = ['CustomVideoControls', 'TimelineHoverPreview', 'CommentSection', 'CommentInput', 'VideoComparisonControls', 'VideoComparison']
const stillReading = screens.filter((name) => {
  const src = readFileSync(`src/components/${name}.tsx`, 'utf8')
  return /mode:\s*timestampDisplayMode|formatTimeWithMode/.test(src)
})
checkTrue('S3 屏幕上一处都不再看那两列（静态版：这条进 CI，浏览器那条 T9·b 在 check-player-spinner 里）',
  stillReading.length === 0, `→ 还在读的：${JSON.stringify(stillReading)}／共查 ${screens.length} 处`)

console.log(`\n合计 ${passed} PASS / ${failures.length} FAIL`)
for (const f of failures) console.log(`  FAIL  ${f}`)
process.exit(failures.length === 0 ? 0 : 1)
