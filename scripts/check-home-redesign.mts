import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 首页改版（对标 frame.io/zh-cn）的判据。他点单的改动点里，凡是能机械核的都钉在这里：
 * 固定深色、字号字距、吸顶栏、章节结构、中文小节名、页脚真链接、对比度、减少动效，
 * 两条把整站打挂过的真事故（CSS Modules 的裸属性选择器、WebGL 起不来时装饰层不许带崩整页），
 * 以及 10-08 点单的动效三条（改动点 1＋3＋5）：首屏是真在播的产品录屏、背景铺满且随指针、
 * 减少动效时两样都停下来。同日第二轮点单的三条（H48–H55）：首屏媒体出血到右边缘且不装进卡片、
 * 章节靠圆角与自带光源分段而不是描边、三张配图是 1:1 裁片而不是缩小的整屏截图；
 * H53/H54 钉的是「光和光源得真的落在像素上」，只有 background-image 里写了不算；
 * H56/H57 钉指针拖尾：划过背景要留下一团会衰减的亮尾，减少动效档则一字节都不许留。
 *
 * H44–H47 那一档必须带 --enable-unsafe-swiftshader 再起一枚 Chrome：没有 WebGL 就没有画布，
 * 「背景随指针变」和「文字压在实际画出来的背景上」这两句只有那枚浏览器里量得到。
 *
 * 只用浏览器与读文件，不写库、不重启他的 dev。口令与凭据一律不进这份文件。
 *
 *   npx tsx scripts/check-home-redesign.mts
 */
const BASE = process.env.HOME_CHECK_BASE || 'http://localhost:3000'
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const CSS_FILE = 'src/app/home.module.css'
const CLIENT_FILE = 'src/app/home-client.tsx'
const BENDS_FILE = 'src/components/ColorBends.tsx'
const HERO_MP4 = 'public/home/hero.mp4'
const HERO_POSTER = 'public/home/hero-poster.jpg'
/** 首屏就放视频，体积是唯一的代价：3MB 是「不许拖 LCP」那条线的落地值。 */
const HERO_MAX_BYTES = 3 * 1024 * 1024
/** 首页固定深色：画布色与 globals.css 里 dark 那套的 --background 一致（#05050a）。 */
const CANVAS = 'rgb(5, 5, 10)'
const SECTIONS = ['platform', 'review', 'versions', 'share', 'collect', 'workflow', 'cta']
const EYEBROWS = ['平台能力', '逐帧批注', '版本与定稿', '分享与交付', '素材收录']

const stamp = Date.now()
const cdpPort = 9600 + (stamp % 300)
const gpuPort = cdpPort + 401
const userDataDir = join(tmpdir(), `home-check-${stamp}`)
const gpuDataDir = join(tmpdir(), `home-check-gpu-${stamp}`)
const failures: string[] = []
let chrome: ChildProcess | undefined
let gpuChrome: ChildProcess | undefined

function check(ok: boolean, label: string, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` → ${detail}` : ''}`)
  if (!ok) failures.push(label)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ── CDP（Node 内置 WebSocket，零依赖） ───────────────────────────────────
let ws: WebSocket | undefined
let msgId = 0
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()

function send(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
  const id = ++msgId
  return new Promise<any>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws?.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error(`CDP 超时：${method}`)) }
    }, 60_000)
  })
}

async function connectChrome(port = cdpPort, dir = userDataDir, extraFlags: string[] = []) {
  // 主档故意不带 --enable-unsafe-swiftshader：没有 WebGL 才是这台机器上最容易复现的那条崩页路径。
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
    '--remote-allow-origins=*', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--lang=zh-CN',
    ...extraFlags,
  ], { stdio: 'ignore' })
  for (let i = 0; i < 60; i++) {
    if (await fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.ok).catch(() => false)) return proc
    await sleep(500)
  }
  proc.kill()
  throw new Error('无头 Chrome 没起来')
}

async function attachVersion(port: number) {
  const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json())
  await attachSocket(webSocketDebuggerUrl)
}

function attachSocket(url: string) {
  return new Promise<void>((resolve, reject) => {
    ws = new WebSocket(url)
    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data))
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id)!
        pending.delete(msg.id)
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error)))
        else p.resolve(msg.result)
      }
    }
    ws.onerror = () => reject(new Error('CDP WebSocket 连接失败'))
    ws.onopen = () => resolve()
  })
}

async function openPage() {
  const { browserContextId } = await send('Target.createBrowserContext', { disposeOnDetach: true })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const page = { browserContextId, targetId, sessionId, s: (m: string, p: Record<string, unknown> = {}) => send(m, p, sessionId) }
  await page.s('Page.enable')
  await page.s('Runtime.enable')
  return page
}
type Page = Awaited<ReturnType<typeof openPage>>

async function evalJs(page: Page, expression: string) {
  const r = await page.s('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(`页面 JS 异常：${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
  return r.result.value
}
async function waitFor(page: Page, expression: string, timeoutMs = 60_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await evalJs(page, `(() => { try { return (${expression}) ? true : false } catch { return false } })()`)) return true
    await sleep(400)
  }
  return false
}
async function closePage(page: Page) {
  await send('Target.closeTarget', { targetId: page.targetId }).catch(() => null)
  await send('Target.disposeBrowserContext', { browserContextId: page.browserContextId }).catch(() => null)
  await sleep(300)
}

/** 页内取一批几何/样式事实；表达式里不许出现反斜杠，所以整段用模板拼。 */
const FACTS = `(() => {
  const cssPx = (v) => parseFloat(v)
  const num = (c) => (c.match(/[\\d.]+/g) || [0, 0, 0, 1]).slice(0, 4).map(Number)
  const over = (fg, bg) => { const a = fg[3] === undefined ? 1 : fg[3]; return [0, 1, 2].map(i => a * fg[i] + (1 - a) * bg[i]) }
  const lum = (c) => { const s = c.map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2] }
  const bgOf = (el) => { let n = el; while (n) { const c = num(getComputedStyle(n).backgroundColor); if ((c[3] === undefined ? 1 : c[3]) === 1) return c.slice(0, 3); n = n.parentElement } return [255, 255, 255] }
  const fails = []
  for (const el of document.querySelectorAll('h1,h2,h3,h4,p,li,a,span,button,td,th,figcaption,blockquote,dt,dd,label')) {
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue
    if (!el.textContent || !el.textContent.trim()) continue
    if ([...el.children].some(k => k.textContent && k.textContent.trim())) continue
    const fs = cssPx(cs.fontSize)
    const big = fs >= 24 || (fs >= 19 && Number(cs.fontWeight) >= 700)
    const r = (Math.max(lum(over(num(cs.color), bgOf(el))), lum(bgOf(el))) + 0.05) / (Math.min(lum(over(num(cs.color), bgOf(el))), lum(bgOf(el))) + 0.05)
    if (r < (big ? 3 : 4.5)) fails.push(el.tagName.toLowerCase() + ' ' + fs + 'px ' + Math.round(r * 100) / 100 + ':1 「' + el.textContent.trim().slice(0, 14) + '」')
  }
  const header = document.querySelector('[class*=headerInner]') ? document.querySelector('[class*=header]') : document.querySelector('[class*=header]')
  const hcs = header ? getComputedStyle(header) : null
  const stuck = document.querySelector('[class*=headerStuck]')
  const h1 = document.querySelector('h1')
  const h1cs = h1 ? getComputedStyle(h1) : null
  const duo = document.querySelector('[class*=duoHead]')
  const duocs = duo ? getComputedStyle(duo) : null
  const reveal = [...document.querySelectorAll('[class*=reveal]')].filter(e => !String(e.className).includes('revealOn'))
  return JSON.stringify({
    pageBg: document.querySelector('[class*=page]') ? getComputedStyle(document.querySelector('[class*=page]')).backgroundColor : null,
    canvasScheme: document.querySelector('[class*=page]') ? getComputedStyle(document.querySelector('[class*=page]')).colorScheme : null,
    rootTheme: document.documentElement.getAttribute('data-theme') || '(none)',
    rootHasDarkClass: document.documentElement.classList.contains('dark'),
    h1Text: h1 ? h1.textContent.trim() : null,
    h1Lines: h1 ? Math.round(h1.getBoundingClientRect().height / parseFloat(getComputedStyle(h1).lineHeight)) : null,
    h1Size: h1cs ? cssPx(h1cs.fontSize) : null,
    h1Tracking: h1cs ? cssPx(h1cs.letterSpacing) : null,
    duoSize: duocs ? cssPx(duocs.fontSize) : null,
    duoTracking: duocs ? cssPx(duocs.letterSpacing) : null,
    headerPosition: hcs ? hcs.position : null,
    headerZ: hcs ? hcs.zIndex : null,
    stuckOn: !!stuck,
    stuckBg: stuck ? getComputedStyle(stuck).backgroundColor : null,
    stuckBlur: stuck ? (getComputedStyle(stuck).backdropFilter || getComputedStyle(stuck).webkitBackdropFilter || '') : null,
    sections: ['platform','review','versions','share','collect','workflow','cta'].map(id => id + ':' + (document.getElementById(id) ? Math.round(document.getElementById(id).getBoundingClientRect().height) : 'missing')),
    eyebrows: [...document.querySelectorAll('[class*=eyebrow]')].map(e => e.textContent.trim()),
    footerCols: document.querySelectorAll('[class*=footerCol]').length,
    icp: (document.querySelector('[class*=footerIcp]') || {}).textContent || null,
    canvases: document.querySelectorAll('canvas').length,
    bendsWrap: !!document.querySelector('[class*=bendsWrap]'),
    // ── 改动点 1＋2＋3（10-08 第二轮）：首屏出血、栏面无描边、每章自带光源、配图按 1:1 裁 ──
    heroBleed: (() => {
      const el = document.querySelector('[class*=heroShot]')
      if (!el) return null
      const b = el.getBoundingClientRect()
      const img = el.querySelector('video, img')
      const cs = img ? getComputedStyle(img) : null
      return {
        rightGap: Math.round(document.documentElement.clientWidth - b.right),
        radius: cs ? [cs.borderTopLeftRadius, cs.borderTopRightRadius] : null,
        border: cs ? [cs.borderTopWidth, cs.borderRightWidth] : null,
        shadow: cs ? (cs.boxShadow === 'none' ? 'none' : 'has') : null,
        halo: (() => { const p = getComputedStyle(el, '::before'); return p.content === 'none' || Number(p.opacity) === 0 ? 'none' : 'has' })(),
      }
    })(),
    panels: [...document.querySelectorAll('[class*=panel]')].filter(e => !String(e.className).includes('panelInner')).map((e) => {
      const cs = getComputedStyle(e)
      // 圆心/颜色这些一律回 Node 侧再解析：这段字符串要塞进页面执行，反斜杠在模板字面量里会被吃掉。
      return { border: cs.borderTopWidth, radius: Math.round(parseFloat(cs.borderTopLeftRadius)), bg: cs.backgroundImage.slice(0, 160) }
    }),
    shotScale: [...document.querySelectorAll('[class*=rowShot] img')].map((i) => {
      const w = i.getBoundingClientRect().width
      return { shown: Math.round(w), natural: i.naturalWidth, ratio: w > 0 ? Math.round(i.naturalWidth / w * 100) / 100 : null }
    }),
    revealPending: reveal.length,
    revealDone: document.querySelectorAll('[class*=revealOn]').length,
    hiddenContact: (() => { const el = [...document.querySelectorAll('[class*=headerLink]')].find(e => e.textContent.trim() === '联系我们'); return el ? getComputedStyle(el).display : 'none' })(),
    docScrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    panelW: (() => { const el = document.querySelector('[class*=panelInner]'); return el ? Math.round(el.getBoundingClientRect().width) : null })(),
    rows: [...document.querySelectorAll('[class*=row]:not([class*=rowCopy]):not([class*=rowShot])')].map((el) => {
      const copy = el.querySelector('[class*=rowCopy]')
      const shot = el.querySelector('[class*=rowShot]')
      const cs = getComputedStyle(el)
      if (!copy || !shot) return null
      const a = copy.getBoundingClientRect(), b = shot.getBoundingClientRect()
      const p = el.querySelector('[class*=rowCopy] h3')
      const pcs = p ? getComputedStyle(p) : null
      return { cols: cs.gridTemplateColumns.split(' ').length, h: Math.round(el.getBoundingClientRect().height),
        copyW: Math.round(a.width), sideBySide: b.left > a.right - 8 || a.left > b.right - 8, shotH: Math.round(b.height),
        imgs: shot.querySelectorAll('img').length, h3: pcs ? Math.round(parseFloat(pcs.fontSize)) : null }
    }).filter(Boolean),
    introW: (() => { const el = document.querySelector('[class*=intro]'); return el ? Math.round(el.getBoundingClientRect().width) : null })(),
    leadType: (() => { const el = document.querySelector('[class*=sectionLead]'); if (!el) return null; const cs = getComputedStyle(el); return { fs: Math.round(parseFloat(cs.fontSize) * 10) / 10, lh: Math.round(parseFloat(cs.lineHeight) / parseFloat(cs.fontSize) * 100) / 100 } })(),
    headType: (() => { const el = document.querySelector('[class*=duoHead]'); if (!el) return null; const cs = getComputedStyle(el); return { fs: Math.round(parseFloat(cs.fontSize) * 10) / 10, lh: Math.round(parseFloat(cs.lineHeight) / parseFloat(cs.fontSize) * 100) / 100 } })(),
    deadImg: [...document.querySelectorAll('img')].filter(i => i.complete && i.naturalWidth === 0).length,
    heroVideo: (() => {
      const v = document.querySelector('video')
      if (!v) return null
      const r = v.getBoundingClientRect()
      return {
        box: [Math.round(r.width), Math.round(r.height)], videoW: v.videoWidth, videoH: v.videoHeight,
        ready: v.readyState, paused: v.paused, t: Math.round(v.currentTime * 100) / 100,
        dur: Math.round((v.duration || 0) * 10) / 10, loop: v.loop, muted: v.muted, inline: v.playsInline,
        src: (v.currentSrc || v.src || '').split('/').pop().slice(0, 30), poster: (v.getAttribute('poster') || '').split('/').pop(),
      }
    })(),
    bendsBox: (() => {
      const el = document.querySelector('[class*=bendsWrap]')
      const zone = document.querySelector('[class*=heroZone]')
      if (!el || !zone) return null
      const a = el.getBoundingClientRect(), b = zone.getBoundingClientRect(), cs = getComputedStyle(el)
      return { w: Math.round(a.width), h: Math.round(a.height), zoneW: Math.round(b.width), zoneH: Math.round(b.height), pe: cs.pointerEvents, op: Number(cs.opacity) }
    })(),
    anchors: [...document.querySelectorAll('a[href^="#"]')].map(a => a.getAttribute('href')).filter((v, i, arr) => arr.indexOf(v) === i),
    brokenAnchors: [...document.querySelectorAll('a[href^="#"]')].map(a => a.getAttribute('href')).filter(h => h.length > 1 && !document.querySelector(h)),
    internalLinks: [...new Set([...document.querySelectorAll('a[href^="/"]')].map(a => a.getAttribute('href')))],
    contrastFails: fails,
  })
})()`

async function facts(page: Page) {
  return JSON.parse(String(await evalJs(page, FACTS)))
}

try {
  // ── 一、源码层：两条打挂过整站的事故不许回来 ─────────────────────────
  console.log('\n── 源码 ──')
  const css = readFileSync(CSS_FILE, 'utf8')
  const client = readFileSync(CLIENT_FILE, 'utf8')
  const bends = readFileSync(BENDS_FILE, 'utf8')

  const impure = (() => {
    // 只看深度 0 的选择器：@media 里的那层缩进过、@keyframes 里的 from/to 也不算选择器。
    const src = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const bad: string[] = []
    let depth = 0
    let buf = ''
    for (const ch of src) {
      if (ch === '{') {
        const sel = buf.trim()
        if (depth === 0 && sel && !sel.startsWith('@') && !/[.#]/.test(sel)) bad.push(sel)
        depth += 1
        buf = ''
      } else if (ch === '}') {
        depth = Math.max(0, depth - 1)
        buf = ''
      } else if (ch === ';') {
        buf = ''
      } else if (depth === 0) {
        buf += ch
      }
    }
    return bad
  })()
  check(impure.length === 0, 'H1 CSS Modules 里没有裸属性/标签选择器（上一版 [data-reveal] 让全站 500）', impure.slice(0, 3).join(' | '))
  check(/\.reveal\b/.test(css) && /\.revealOn\b/.test(css) && !/data-reveal/.test(css) && !/data-reveal/.test(client),
    'H2 滚动浮现改成局部类名，属性选择器清零')
  check(/try\s*\{[\s\S]{0,200}new THREE\.WebGLRenderer/.test(bends) && /catch/.test(bends),
    'H3 装饰层 WebGLRenderer 构造被 try 兜住（没有 WebGL 不许带崩整页）')
  check(!/aria-label="逐帧审阅首页"/.test(client.match(/<section[^>]*/g)?.join('') || ''),
    'H4 首屏 section 不再和顶栏品牌共用同一个无障碍名')

  // ── 一·二、改动点 1＋3＋5（10-08 点单）：首屏真视频、背景铺满跟指针、减少动效停下来 ──
  console.log('\n── 首屏视频与背景层（源码） ──')
  const { execFileSync: probe } = await import('node:child_process')
  const fps = (p: string, args: string[]) => { try { return probe('ffprobe', ['-v', 'error', ...args, p], { encoding: 'utf8' }).trim() } catch { return '' } }
  const movieTag = (client.match(/<video[\s\S]{0,700}?\/>/) || [''])[0]
  check(/src="\/home\/hero\.mp4"/.test(movieTag) && /poster="\/home\/hero-poster\.jpg"/.test(movieTag) && /muted/.test(movieTag) && /loop/.test(movieTag) && /playsInline/.test(movieTag),
    'H36 首屏是 <video src=hero.mp4 poster=hero-poster.jpg muted loop playsInline>', movieTag ? `→ 标签 ${movieTag.length} 字` : '→ markup 里没有 <video>')
  let mp4Bytes = 0
  try { mp4Bytes = statSync(HERO_MP4).size } catch { /* 还没录出来，下面按缺文件判红 */ }
  if (mp4Bytes === 0) {
    check(false, `H36·b ${HERO_MP4} 存在`, '→ 文件不在（先跑 npx tsx --env-file=.env scripts/capture-home-movie.mts）')
  } else {
    const w = Number(fps(HERO_MP4, ['-select_streams', 'v:0', '-show_entries', 'stream=width', '-of', 'csv=p=0']))
    const dur = Number(fps(HERO_MP4, ['-show_entries', 'format=duration', '-of', 'csv=p=0']))
    const audio = fps(HERO_MP4, ['-select_streams', 'a', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0'])
    check(w >= 1540, `H36·c hero.mp4 实测宽 ${w}（1440 视口里渲染宽实测 770 CSS px，2x 屏要 1540；10-08 从 1920 降到 1600 就是为了砍这一半字节）`)
    check(dur >= 10 && dur <= 16, `H36·d 时长 ${dur.toFixed(1)}s（对标那枚 hero 18.2s，短于 10s 循环感就露出来了）`)
    check(audio === '', 'H36·e 没有音轨（自动播的装饰片不许带声音）', audio)
    const head = readFileSync(HERO_MP4).subarray(0, 262_144).toString('latin1')
    const mdat = head.indexOf('mdat')
    check(head.includes('moov') && (mdat < 0 || head.indexOf('moov') < mdat),
      'H36·f moov 排在 mdat 前面（+faststart：不前置就得整包下完才肯画第一帧）')
    check(mp4Bytes < HERO_MAX_BYTES, `H37 hero.mp4 ${(mp4Bytes / 1024 / 1024).toFixed(2)}MB < 3MB（首屏不许拖 LCP）`)
  }
  const orphan = readFileSync('src/app/home-client.tsx', 'utf8').includes('review-ui.png')
    || readFileSync('scripts/capture-home-shots.mts', 'utf8').includes("': 'review-ui.png'")
  check(!orphan, 'H41 首屏那张静帧退役了：markup 与截图脚本都不再产 review-ui.png')
  let posterOk = false
  try { posterOk = statSync(HERO_POSTER).size > 0 } catch { /* 判红 */ }
  check(posterOk, `H41·b ${HERO_POSTER} 在（视频首帧当海报，加载前不许是空洞）`)

  check(/window\.addEventListener\('pointermove'/.test(bends) && !/container\.addEventListener\('pointermove'/.test(bends),
    'H43 指针监听挪到 window（背景层在内容底下、还吃着 pointer-events:none，挂容器永远收不到事件）')
  check(/Math\.max\(-1,[\s\S]{0,80}Math\.min\(1,/.test(bends), 'H43·b 指针坐标夹在 ±1，鼠标划出首屏不许把着色器推过头')

  // ── 二、深色配图：产品图必须是深色那套界面 ───────────────────────────
  console.log('\n── 配图 ──')
  const sharp = (await import('sharp')).default
  // 首页配图糊不糊，根在源片分辨率：模板片只有 960×506，放大到 1920 就是马赛克。
  const { execFileSync } = await import('node:child_process')
  const SRC_CLIPS = ['night-city-aerial', 'set-behind-scenes', 'dusk-drone']
    .map(n => `uploads/marketing-src/${n}.mp4`)
    .filter((f) => { try { return statSync(f).size > 0 } catch { return false } })
  if (SRC_CLIPS.length === 0) {
    console.log('SKIP H6·c 演示源片不在 uploads/marketing-src/（本地未放，判据不判红；缺片时 build-home-demo 会退回 960×506 模板片）')
  } else {
    for (const f of SRC_CLIPS) {
      const line = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim()
      check(Number(line) >= 1920, `H6·c ${f.split('/').pop()} 源片宽 ${line}（<1920 就会被放大、首页配图必糊）`)
    }
  }

  // 宽高不许写死在这儿：从首页 markup 里读 <Image> 声明的那一对，再和文件实测比。
  const declared = new Map<string, [number, number]>()
  for (const m of client.matchAll(/src="\/home\/([\w.-]+\.png)"[\s\S]{0,240}?width=\{(\d+)\}\s*height=\{(\d+)\}/g)) {
    declared.set(m[1], [Number(m[2]), Number(m[3])])
  }
  check(declared.size === 3, `H4·b 首页声明了 ${declared.size} 张配图（首屏那张 10-08 换成真视频了，应当剩 3 张）`, [...declared.keys()].join(' '))
  for (const [name, [w, h]] of declared) {
    const file = `public/home/${name}`
    const meta = await sharp(file).metadata()
    check(meta.width === w && meta.height === h, `H5 ${name} 实测 ${meta.width}×${meta.height} 与 <Image width height> 一致`, `${w}×${h}`)
    const top = await sharp(file).extract({ left: 0, top: 0, width: 200, height: 24 }).stats()
    const mean = top.channels.slice(0, 3).reduce((a, c) => a + c.mean, 0)
    check(mean < 400, `H6 ${name} 顶栏是深色界面（三通道均值 ${Math.round(mean)}，浅色那套在 1900 上下）`)
    // 画面区按各张图的取景比例取：这三张现在是从界面上裁下来的 1:1 碎片（不再是整屏），
    // 批注那张几乎全是画面，版本那张几乎全是卡片。
    const frac = name === 'review-comments.png' ? [0.02, 0.05, 0.9, 0.6] : [0.02, 0.08, 0.9, 0.7]
    const box = { left: Math.round(meta.width * frac[0]), top: Math.round(meta.height * frac[1]), width: Math.round(meta.width * frac[2]), height: Math.round(meta.height * frac[3]) }
    if (name === 'collect-upload.png') continue
    const detail = await sharp(file).extract(box).stats()
    const sd = detail.channels.slice(0, 3).reduce((a, c) => a + c.stdev, 0)
    check(sd > 60, `H6·b ${name} 画面区是真素材、不是黑块或纯色占位（三通道标准差 ${Math.round(sd)}）`)
  }

  // ── 三、浏览器：1440 主档 ────────────────────────────────────────────
  console.log('\n── 浏览器 1440 ──')
  chrome = await connectChrome()
  const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${cdpPort}/json/version`).then((r) => r.json())
  await attachSocket(webSocketDebuggerUrl)
  const page = await openPage()
  // 访客存过浅色主题也不许带走首页：这条是「固定深色」的全部含义。
  await page.s('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('theme', 'light');` })
  await page.s('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await page.s('Page.navigate', { url: `${BASE}/` })
  check(await waitFor(page, `document.querySelector('h1') && document.querySelector('h1').textContent.indexOf('意见') >= 0`, 90_000),
    'H7 首页画出主标题（没有 WebGL 的浏览器里整页照样在）')
  await sleep(2500)
  let f = await facts(page)
  check(f.pageBg === CANVAS && f.rootHasDarkClass === false, 'H8 首页画布固定 #05050a，且不靠 html.dark 那层开关', `${f.pageBg} / data-theme=${f.rootTheme}`)
  check(f.canvases === 0 && f.bendsWrap === true, 'H9 没有 WebGL 时装饰层静默退场，页面其余部分照常（崩页回归点）', `${f.canvases} 枚 canvas`)
  check(f.h1Size >= 60 && f.h1Size <= 70 && f.h1Tracking <= -1.5, `H10 主标题 ${f.h1Size}px / 字距 ${f.h1Tracking}px（对标 80px 在 1711 宽 = 4.7vw，且不许把两行断成四行）`)
  check(f.h1Lines === 2, `H10·b 主标题在两行里排完（断成三行就是字号压不住栏宽）`, `→ ${f.h1Lines} 行`)
  check(f.duoSize >= 40 && f.duoTracking <= -1, `H11 章节标题 ${f.duoSize}px / 字距 ${f.duoTracking}px`, '≥40px 且字距 ≤ -1px')
  check(f.headerPosition === 'sticky' && Number(f.headerZ) >= 40, `H12 顶栏吸顶（position ${f.headerPosition} / z ${f.headerZ}）`)
  check(f.hiddenContact !== 'none', 'H13 1440 那一屏「联系我们」在顶栏里', f.hiddenContact)
  const missing = SECTIONS.filter((id) => !f.sections.some((s: string) => s.startsWith(`${id}:`) && !s.endsWith('missing') && Number(s.split(':')[1]) > 80))
  check(missing.length === 0, 'H14 七个区块都画出来了且不是空壳', f.sections.join(' '))
  check(JSON.stringify(f.eyebrows) === JSON.stringify(EYEBROWS), 'H15 五枚小节名是中文、顺序对得上锚点', JSON.stringify(f.eyebrows))
  check(f.footerCols === 4 && /桂ICP备/.test(String(f.icp)), `H16 页脚四列链接 + 备案号`, `${f.footerCols} 列`)
  check(f.brokenAnchors.length === 0, 'H17 页内锚点全部落在真实 id 上', JSON.stringify(f.brokenAnchors))
  const cfg = readFileSync('next.config.js', 'utf8')
  check(/qualities:\s*\[[^\]]*90/.test(cfg) && (client.match(/quality=\{90\}/g) || []).length === 3,
    'H35 三张配图 quality=90 且白名单放行（默认只有 75，暗底小字会糊）',
    `→ 跑中的 dev 仍按启动时的旧配置出 q=75，重启后才是 q=90：${String(await evalJs(page, `[...document.querySelectorAll('img')].map(i => i.srcset || '').join(' ')`).catch(() => 'n/a')).match(/q=\d+/)?.[0] ?? 'n/a'}`)
  check(f.deadImg === 0, 'H18 首页没有加载失败的图（已画完但 0 像素的那种）', String(f.deadImg))

  // 首屏那段视频：这一枚 Chrome 没有 WebGL，但 H.264 照播——「素材是动的」这句只有实测算数。
  // 首屏那段是自动播的装饰片：先等它真走出第一帧（dev 正在重编译时网络会卡住，定长 sleep 会误判），
  // 再看 1.4 秒里 currentTime 有没有继续长——paused=false 但时间不动的那种假播放要抓得出来。
  const started = await waitFor(page, `(() => { const v = document.querySelector('video'); return v && v.currentTime > 0.2 })()`, 20_000)
  const t0 = (await facts(page)).heroVideo?.t ?? -1
  await sleep(1400)
  const fv = (await facts(page)).heroVideo
  check(Boolean(fv), 'H38 首屏画出了 <video> 元素', fv ? `${fv.box?.join('×')} CSS px` : '→ 没有 video')
  check(Boolean(fv) && fv.videoW >= 1540 && fv.ready >= 2, `H38·b 视频真解码到了画面（${fv?.videoW}×${fv?.videoH}，readyState ${fv?.ready}）`, `→ src ${fv?.src}`)
  check(started && Boolean(fv) && fv.paused === false && fv.t > t0, `H38·c 它在跑（currentTime ${t0} → ${fv?.t}）`, fv ? `paused=${fv.paused} / 时长 ${fv.dur}s / loop=${fv.loop} / muted=${fv.muted} / playsInline=${fv.inline}` : '')
  check(Boolean(fv) && fv.poster === 'hero-poster.jpg' && fv.muted === true && fv.loop === true && fv.inline === true,
    'H38·d 海报、静音、循环、内联播放四样都在', `→ poster=${fv?.poster}`)
  const bb = f.bendsBox
  check(Boolean(bb) && bb.w >= bb.zoneW - 2 && bb.h >= bb.zoneH * 0.8 && bb.pe === 'none',
    `H42 背景层铺满整块首屏（实测 ${bb?.w}×${bb?.h}，首屏 ${bb?.zoneW}×${bb?.zoneH}，pointer-events ${bb?.pe}）`, `→ opacity ${bb?.op}`)

  // ── 10-08 第二轮：走查完整首屏后点单的 1＋2＋3 ──────────────────────────
  const hb = f.heroBleed
  check(Boolean(hb) && hb.rightGap <= 2, `H48 首屏那块媒体出血到浏览器右边缘（离右边缘 ${hb?.rightGap}px）`,
    '→ frame.io 的产品画面顶到右边缘、底部被裁，我们上一版是「装进描边卡片里的一张 16:9 图」')
  const rad = (hb?.radius || ['0px', '0px']).map((v: string) => parseFloat(v) || 0)
  check(Boolean(hb) && hb.shadow === 'none' && hb.halo === 'none' && Math.max(...rad) <= 6 && (hb.border || []).every((v: string) => parseFloat(v) === 0),
    `H49 首屏媒体去掉描边、阴影、面板光晕，圆角收到 ${Math.max(...rad)}px（对标实测 5px、无描边、无阴影）`,
    `→ border ${(hb?.border || []).join('/')} / shadow ${hb?.shadow} / halo ${hb?.halo}`)
  const pl = (f.panels as any[]).map((p) => {
    const m = p.bg.match(/radial-gradient\([^)]*?at\s+(-?[\d.]+%)\s+(-?[\d.]+%)/)
    return { border: p.border, radius: p.radius, has: /radial-gradient/.test(p.bg), at: m ? `${m[1]} ${m[2]}` : '' }
  })
  check(pl.length >= 3 && pl.every((p) => p.has && parseFloat(p.border) === 0 && p.radius >= 12),
    `H50 ${pl.length} 块章节栏面：无描边、圆角还在、每块自带 radial 光源（分段靠圆角与光，不靠线）`,
    pl.map((p) => `${p.border}/${p.radius}px${p.has ? '' : ' 无光'}`).join(' ｜ '))
  check(new Set(pl.map((p) => p.at)).size >= 2,
    `H51 光源圆心在章与章之间换位置（这就是「光跟着滚动走」的来处），实测 ${[...new Set(pl.map((p) => p.at))].join(' ｜ ')}`)
  // 章节配图是懒加载的：不先滚一遍把三张都请求下来，naturalWidth 就是 0，那条比值会假绿。
  await evalJs(page, `scrollTo(0, document.documentElement.scrollHeight)`)
  const loaded = await waitFor(page, `(() => { const im = [...document.querySelectorAll('[class*=rowShot] img')]
    return im.length >= 3 && im.every(i => i.complete && i.naturalWidth > 0) })()`, 45_000)
  await evalJs(page, `scrollTo(0, 1455)`)
  await sleep(900)
  const sc = (await facts(page)).shotScale as any[]
  // 这三张按 deviceScaleFactor=2 拍、且不再 resample 到 2160（见 capture-home-shots.mts），
  // 所以 naturalWidth / 2 就是当初裁下去的那块 CSS 宽度 ⇒ 放大率 = shown / (natural/2) = 2·shown/natural。
  // 要求放大率 ≥ 0.75（界面里 14px 的正文缩到 10.5px 以下就读不动了）⇔ natural/shown ≤ 2.67。
  check(loaded && sc.length >= 3 && sc.every((s) => s.natural > 0 && s.ratio !== null && s.ratio <= 2.67),
    `H52 三张章节配图是 1:1 裁片：放大率 ≥ 0.75（实测 natural/显示宽 = ${sc.map((s) => `${s.natural}/${s.shown}=${s.ratio}× → ${(2 / s.ratio).toFixed(2)}倍`).join(' ｜ ')}）`,
    '→ 上一版是 1440 CSS 宽的整屏图缩到 616 CSS px（0.43 倍），字全糊，这才是「素材不发清」的真因')

  const codes: string[] = []
  for (const href of f.internalLinks as string[]) {
    const res = await fetch(BASE + href, { redirect: 'manual' })
    if (res.status >= 400) codes.push(`${href}=${res.status}`)
  }
  check(codes.length === 0, `H19 站内 ${f.internalLinks.length} 条链接逐个取一遍，没有 4xx/5xx`, codes.join(' '))
  check(f.contrastFails.length === 0, 'H20 1440 全页文字对比度扫一遍（正文 ≥4.5:1，大字 ≥3:1）', f.contrastFails.slice(0, 4).join(' | '))

  // 吸顶后的那条毛玻璃
  await evalJs(page, `scrollTo(0, 1200)`)
  await sleep(1200)
  f = await facts(page)
  check(f.stuckOn && /rgba?\(5, 5, 10/.test(String(f.stuckBg)) && /blur/.test(String(f.stuckBlur)),
    'H21 滚动后顶栏换成半透明＋模糊底（headerStuck 生效）', `${f.stuckBg} ${f.stuckBlur}`)
  const stillHidden = await evalJs(page, `(() => { const el = [...document.querySelectorAll('[class*=headerLink]')].find(e => e.textContent.trim() === '联系我们'); return el ? getComputedStyle(el).display : 'gone' })()`)
  check(stillHidden === 'inline-flex' || stillHidden === 'block' || stillHidden === 'inline', 'H22 吸顶后「联系我们」还在（不是被 sticky 挤掉）', stillHidden)

  // 滚动浮现：进入视口的那一枚要翻成 revealOn
  const revealed = await waitFor(page, `[...document.querySelectorAll('[class*=reveal]')].some(e => String(e.className).includes('revealOn'))`, 15_000)
  f = await facts(page)
  check(revealed && f.revealDone > 0, `H23 滚到章节时浮现动画真的挂了 revealOn（${f.revealDone} 枚已亮、${f.revealPending} 枚待亮）`)

  // 装饰性循环滚出视口就该停（animate.md 那条硬要求），否则用户在看第三屏、第一屏还在烧解码器和电。
  await evalJs(page, `scrollTo(0, 4000)`)
  await sleep(1600)
  const off = (await facts(page)).heroVideo
  check(Boolean(off) && off.paused === true, 'H39 首屏滚出视口后视频自己停了', off ? `paused=${off.paused} / currentTime=${off.t}` : '')

  // ── 三·二、对标骨架：窄栅格 + 并排行（10-07「差距还是太大了」那一轮）───
  console.log('\n── 对标骨架 ──')
  const f2 = await facts(page)
  check(f2.panelW !== null && f2.panelW <= 1120, `H29 章节内容容器实测 ${f2.panelW}px（对标 1080，上一版铺到 1400）`)
  check(f2.introW !== null && f2.introW <= 480, `H30 章节文案栏锁在 ${f2.introW}px 窄栏（对标 436）`)
  check(f2.headType && f2.headType.lh <= 1.08, `H31 章节标题行距 ${f2.headType?.lh}（对标 48/49 = 1.02）`)
  check(f2.leadType && f2.leadType.fs >= 15 && f2.leadType.lh <= 1.6, `H32 正文 ${f2.leadType?.fs}px / 行距 ${f2.leadType?.lh}（对标 15/21.8 = 1.45）`)
  const okRows = (f2.rows as any[]).filter((r) => r.cols === 2 && r.sideBySide && r.imgs >= 1 && r.copyW <= 480)
  check(okRows.length >= 3, `H33 至少三行是真的「窄文案 + 大视觉」并排（实测 ${okRows.length} 行 / ${(f2.rows as any[]).length} 行）`,
    (f2.rows as any[]).map((r) => `${r.cols}列 文案${r.copyW} 图${r.shotH}高 ${r.sideBySide ? '并排' : '叠放'}`).join(' | '))
  check((f2.rows as any[]).every((r) => r.h >= 420), `H34 并排行有高度（对标 800 那一档），实测 ${(f2.rows as any[]).map(r => r.h).join('/')}`)

  // ── 四、三档宽度：不许出现横向溢出 ───────────────────────────────────
  console.log('\n── 断点 ──')
  for (const [w, h] of [[1440, 900], [960, 900], [720, 900], [390, 844]] as const) {
    await page.s('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 })
    await sleep(1200)
    const g = await facts(page)
    check(g.docScrollW <= g.clientW, `H24 ${w}px 那一档没有横向溢出`, `${g.docScrollW} vs ${g.clientW}`)
    check((g.heroBleed?.rightGap ?? 99) <= 2, `H55 ${w}px 那一档首屏媒体都顶到右边缘`, `→ 离右边缘 ${g.heroBleed?.rightGap}px`)
    if (w === 390) check(g.hiddenContact === 'none', 'H25 390 那一档顶栏收起「联系我们」（页脚里同一枚还在）', g.hiddenContact)
    check(g.contrastFails.length === 0, `H26 ${w}px 那一档文字对比度达标`, g.contrastFails.slice(0, 3).join(' | '))
  }

  // ── 五、减少动效 ─────────────────────────────────────────────────────
  console.log('\n── 减少动效 ──')
  await page.s('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await page.s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await page.s('Page.navigate', { url: `${BASE}/` })
  await waitFor(page, `document.querySelector('h1')`, 60_000)
  await sleep(1500)
  const rm = JSON.parse(String(await evalJs(page, `(() => {
    const els = [...document.querySelectorAll('[class*=reveal]')]
    const hid = els.filter(e => Number(getComputedStyle(e).opacity) < 0.99)
    const cue = document.querySelector('[class*=heroCue]')
    const v = document.querySelector('video')
    return JSON.stringify({ total: els.length, hidden: hid.length, cueAnim: cue ? getComputedStyle(cue).animationName : 'none',
      hasVideo: !!v, paused: v ? v.paused : null, t: v ? Math.round(v.currentTime * 100) / 100 : null, ready: v ? v.readyState : null })
  })()`)))
  check(rm.hidden === 0 && rm.total > 0, 'H27 减少动效时区块直接可见（没有淡入留白）', `${rm.total} 枚里 ${rm.hidden} 枚还藏着`)
  check(rm.cueAnim === 'none', 'H28 向下箭头不再上下漂', rm.cueAnim)
  check(rm.hasVideo === true && rm.paused === true && rm.t === 0,
    'H40 减少动效时首屏不自动播，停在海报那一帧（autoplay 不吃系统设置，必须自己判）',
    `→ paused=${rm.paused} currentTime=${rm.t} readyState=${rm.ready}`)
  await closePage(page)
  chrome?.kill()
  chrome = undefined
  await sleep(600)

  // ── 六、有 WebGL 那一档：背景随指针、文字压在实际画出来的背景上 ────────
  // 没有画布就没有这三句的证据，所以这枚 Chrome 必须带 --enable-unsafe-swiftshader。
  console.log('\n── 有 WebGL 那一档 ──')
  gpuChrome = await connectChrome(gpuPort, gpuDataDir, ['--enable-unsafe-swiftshader'])
  await attachVersion(gpuPort)
  const gp = await openPage()
  await gp.s('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('theme', 'light');` })
  await gp.s('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await gp.s('Page.navigate', { url: `${BASE}/` })
  check(await waitFor(gp, `document.querySelector('canvas')`, 90_000), 'H44 有 WebGL 时装饰层真的画出了画布（崩页回归点的另一面）')
  await sleep(1500)
  const gf = await facts(gp)
  check(Boolean(gf.bendsBox) && gf.bendsBox.w >= 1400 && gf.canvases === 1,
    `H44·b 画布铺在整块首屏上（${gf.bendsBox?.w}×${gf.bendsBox?.h}，${gf.canvases} 枚画布）`)
  // 只有这一档能拍到「画布真的合成在页面上」那张证据，别的地方拍不到。
  if (process.env.HOME_SHOT_OUT) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(process.env.HOME_SHOT_OUT, Buffer.from((await gp.s('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
    console.log(`证据截图：${process.env.HOME_SHOT_OUT}`)
  }
  // 首屏视频也在解码出画、鼠标底下还可能有 hover，整屏裁剪量到的差证明不了是背景层。
  // 所以先要找到一块「只有背景、而且背景真的在动」的方片：① 页面上按 40px 网格取命中元素，
  // 只有命中首屏那几个不画底的容器、且四周 9 个采样点都干净才算候选；② 整屏连拍两帧隔 1 秒，
  // 逐候选块量这两帧的差，动得最多的那一块就是画布透出来的地方。按「哪最亮」选会选到一块静止的
  // 装饰区（实测选中过左上角，两帧逐字节相同），按「哪在动」选才是自校准的。
  await evalJs(gp, `(() => { const v = document.querySelector('video'); if (v) v.pause(); return true })()`)
  const candidates: number[][] = JSON.parse(String(await evalJs(gp, `(() => {
    const zone = document.querySelector('[class*=heroZone]')
    const hero = document.querySelector('section[class*=hero]')
    const page = document.querySelector('[class*=page]')
    const clean = (x, y) => {
      const el = document.elementFromPoint(x, y)
      if (!el || (el !== zone && el !== hero && el !== page)) return false
      const cs = getComputedStyle(el)
      return cs.backgroundColor === 'rgba(0, 0, 0, 0)' && cs.backgroundImage === 'none'
    }
    const hits = []
    for (let y = 140; y < innerHeight - 100; y += 40) {
      for (let x = 90; x < innerWidth - 90; x += 40) {
        let ok = true
        for (const [dx, dy] of [[-66,-66],[0,-66],[66,-66],[-66,0],[0,0],[66,0],[-66,66],[0,66],[66,66]]) {
          if (!clean(x + dx, y + dy)) { ok = false; break }
        }
        if (ok) hits.push([x, y])
      }
    }
    return JSON.stringify(hits.slice(0, 80))
  })()`)))
  const FULL = { x: 0, y: 0, width: 1440, height: 900, scale: 1 }
  const grab = async (clip: { x: number; y: number; width: number; height: number }) =>
    Buffer.from((await gp.s('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } })).data, 'base64')
  // 章节栏面比一屏高，取视口外的方片要开 captureBeyondViewport，坐标按文档算。
  const grabDoc = async (clip: { x: number; y: number; width: number; height: number }) =>
    Buffer.from((await gp.s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...clip, scale: 1 } })).data, 'base64')
  const px = async (buf: Buffer) => (await sharp(buf).removeAlpha().raw().toBuffer())
  const diff = (a: Buffer, b: Buffer) => {
    const n = Math.min(a.length, b.length)
    let d = 0
    for (let i = 0; i < n; i += 3) d += Math.abs(a[i] - b[i])
    return d / (n / 3)
  }
  const VW = 1440
  const frameA = await px(await grab(FULL))
  await sleep(1000)
  const frameB = await px(await grab(FULL))
  let patch = { x: 0, y: 0, width: 132, height: 132 }
  let motion = -1
  let lit = -1
  for (const [cx, cy] of candidates) {
    const x0 = Math.max(0, Math.min(VW - 132, cx - 66))
    const y0 = Math.max(0, Math.min(900 - 132, cy - 66))
    let d = 0
    let lum = 0
    for (let y = y0; y < y0 + 132; y++) {
      for (let x = x0; x < x0 + 132; x++) {
        const i = (y * VW + x) * 3
        d += Math.abs(frameA[i] - frameB[i]) + Math.abs(frameA[i + 1] - frameB[i + 1]) + Math.abs(frameA[i + 2] - frameB[i + 2])
        lum += (frameA[i] + frameA[i + 1] + frameA[i + 2]) / 3
      }
    }
    const m = d / (132 * 132 * 3)
    if (m > motion) { motion = m; lit = lum / (132 * 132); patch = { x: x0, y: y0, width: 132, height: 132 } }
  }
  check(candidates.length > 0 && motion > 0.5,
    `H44·c 找得到一块「只有背景、且背景在动」的方片（${candidates.length} 个干净候选里动得最多的一块：一秒内平均通道差 ${motion.toFixed(2)}，灰度均值 ${lit.toFixed(1)}）`,
    `→ ${patch.x},${patch.y}`)
  // 「测得出在动」不等于「看得见」：bandWidth=4 时那层画布叠到页面上只有灰 9.7，
  // H45 照样全绿，人看到的是一条死黑背景。所以把同一块方片的亮度单独钉一条。
  // 对标 frame.io 首屏同一块量到 37.3；这条线卡在 16，是改前那版的 1.6 倍、对标的四成。
  check(lit >= 16, `H53 首屏背景层真的看得见（在动方片灰度均值 ${lit.toFixed(1)}，要 ≥16；改前 9.7、对标 37.3）`)

  // H50/H51 只证明 background-image 里写了 radial，量不到它落到像素上有多亮。
  // 每一章上下各有 128px 是自己的留白、不压内容，所以沿顶边与底边各取两块 100×100 方片，
  // 四块里的最大差就是这一章的光程（改前 alpha 0.11 时这个差只有 4 个单位＝看不出来）。
  const bandRects: { x: number; y: number; w: number; h: number }[] = JSON.parse(String(await evalJs(gp, `(() => {
    const sy = scrollY
    return JSON.stringify([...document.querySelectorAll('[class*=panel]')]
      .filter(e => !String(e.className).includes('panelInner'))
      .map(e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + sy), w: Math.round(r.width), h: Math.round(r.height) } }))
  })()`)))
  const meanGray = async (x: number, y: number) => {
    const raw = await px(await grabDoc({ x, y, width: 100, height: 100 }))
    let s = 0
    for (let i = 0; i < raw.length; i += 3) s += (raw[i] + raw[i + 1] + raw[i + 2]) / 3
    return s / (raw.length / 3)
  }
  const lightRange = []
  for (const b of bandRects) {
    const g = [
      await meanGray(b.x + 40, b.y + 14),
      await meanGray(b.x + b.w - 140, b.y + 14),
      await meanGray(b.x + 40, b.y + b.h - 114),
      await meanGray(b.x + b.w - 140, b.y + b.h - 114),
    ]
    lightRange.push(Math.max(...g) - Math.min(...g))
  }
  check(bandRects.length >= 3 && lightRange.every((r) => r >= 8),
    `H54 ${bandRects.length} 块章节栏面各自的光真的落在像素上（每块顶/底两条留白带上的四块方片，最亮减最暗 = ${lightRange.map((r) => r.toFixed(1)).join(' ｜ ')}，要 ≥8）`)
  // 两个指针位置取这一屏的最上沿与最下沿：候选块最远只到 y 74–834，
  // 所以这两处永远在方片之外，而 uPointer 的纵向位移拉到接近满程。
  // ⚠️ 纵向路径必须离方片 ≥320px（拖尾半径 TRAIL_RADIUS=0.15 归一化 ≈ 216px）：
  // 之前沿方片自己那一列上下穿，指针把拖尾直接拖进了被量的方块，于是必须等 2.6 秒（≈拖尾 3 个时间常数）
  // 才敢拍；而 2.6 秒的间隔里背景自己那 31 秒呼吸周期能漂 ~5 个通道单位，和指针效应（实测 7.4）同量级，
  // cos 就被共模残差吃掉——同一份代码两次跑出 -0.92 与 -0.32，纯看落在呼吸的哪一段。
  // 现在走旁边一列、拖尾碰不到方片，等待缩到 700ms（指针 lerp τ≈125ms 的 5.6 倍），呼吸窗口只剩 ~1.4。
  const awayFrom = patch.x + Math.round(patch.width / 2)
  const px2 = Math.max(8, Math.min(1432, awayFrom < 720 ? patch.x + patch.width + 320 : patch.x - 320))
  const TRAIL_CLEAR = Math.abs(px2 - awayFrom) - Math.round(patch.width / 2)
  const TOP_Y = 14
  const BOT_Y = 886
  const move = async (x: number, y: number) => {
    await gp.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await sleep(700)
  }
  // 背景变强之后时间漂移本身就有 7 个通道单位，「换位差 ÷ 同位差」的比值会被它吃掉（实测 1.2×）。
  // 换成反相关判据：TOP→BOT 的差向量与 BOT→TOP 的差向量必须几乎反向（纯指针位移是往复的，
  // 时间漂移是共模的、两个方向上同向），所以 cos 越接近 -1 越是指针在起作用，接近 0 就是噪声。
  const sub = (a: Buffer, b: Buffer) => Float64Array.from({ length: a.length }, (_, i) => a[i] - b[i])
  const cos = (u: Float64Array, v: Float64Array) => {
    let s = 0, n1 = 0, n2 = 0
    for (let i = 0; i < u.length; i++) { s += u[i] * v[i]; n1 += u[i] * u[i]; n2 += v[i] * v[i] }
    return s / Math.sqrt(n1 * n2 || 1)
  }
  const shots: Buffer[] = []
  for (let k = 0; k < 4; k++) {
    await move(px2, k % 2 === 0 ? TOP_Y : BOT_Y)
    shots.push(await px(await grab(patch)))
  }
  const pairs: { c: number; m: number }[] = []
  for (let k = 0; k + 2 < shots.length; k += 2) {
    const d1 = sub(shots[k + 1], shots[k])
    const d2 = sub(shots[k + 2], shots[k + 1])
    pairs.push({ c: cos(d1, d2), m: diff(shots[k + 1], shots[k]) })
  }
  const anti = Math.max(...pairs.map((p) => p.c))
  const swept = pairs.reduce((a, p) => a + p.m, 0) / pairs.length
  check(anti < -0.5 && swept > 0.4,
    `H45 背景条带真的随指针变（条带 ${patch.x},${patch.y} ${patch.width}×${patch.height}，指针走旁边一列、离条带 ${TRAIL_CLEAR}px（拖尾半径约 216），在条带外 ${TOP_Y}↔${BOT_Y} 往复 4 趟、每趟等 700ms：换位幅度 ${swept.toFixed(2)}，往复差向量最不负的 cos ${anti.toFixed(2)}，要 <-0.5）`)
  // ── 拖尾（对标他们流体解算里 splat + densityDissipation 那套机制：划过留亮尾，移开要衰减）──
  // ⚠️ 这块量法换了五轮，前四轮全被"背景自己在动"打穿：H44·c 那块一秒漂 14.7 个通道单位；
  //    按"划过→移开→隔时对比"量会假绿；换成"最静那一小块"四趟散布仍有 ±28；放大到整屏后噪声降到
  //    ±5，但仍输给背景自己的**31 秒呼吸周期**（着色器里 `q += 0.2*cos(t)`、t = 秒×0.2 ⇒ 周期 2π/0.2，
  //    幅度 ±10，比拖尾本身还大）——任何"隔几秒比一次"的量法都会被它按相位随机打。
  // 定稿用**同一帧内的空间高通**：路径那一行，减它上下各 250px 的两条对照行（亮斑半径 147px，
  //    250px 处只剩 4%，对照行基本不接尾迹）。三条行在同一帧里取，呼吸对它们同量，一减就掉；
  //    两种走法指针终点都是同一个角落，条带对指针的响应完全共模；对照那一趟故意横穿**上对照行**（y=200），
  //    亮尾改从"被减的那一侧"进来。⚠️ 但它不会把统计量打成负数：亮斑半径 147px、行带只有 60px 高，
  //    一团光摊到三条行上还剩一点正基线（实测对照 ≈ +2.2），所以门槛只看"比信号小一个量级"。
  const mean = (v: number[]) => v.reduce((a, x) => a + x, 0) / v.length
  // 首屏那块媒体占掉 45% 画幅、又不接拖尾，算进均值就是稀释信号，所以按行取均值时挖掉它。
  const vrect = JSON.parse(String(await evalJs(gp, `(() => { const r = document.querySelector('video').getBoundingClientRect()
    return JSON.stringify({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }) })()`))) as { x: number; y: number; w: number; h: number }
  // 三条行带固定不动：中间那条是"路径该落在的地方"，上下两条各离它 250px 当对照。
  const MID = [420, 480]
  const FLANK: [number, number][] = [[170, 230], [670, 730]]
  const meanBand = (buf: Buffer, y0: number, y1: number) => {
    let s = 0
    let n = 0
    for (let y = y0; y < y1; y++) {
      const hide = y >= vrect.y && y < vrect.y + vrect.h
      for (let x = 0; x < 1440; x++) {
        if (hide && x >= vrect.x && x < vrect.x + vrect.w) continue
        const i = (y * 1440 + x) * 3
        s += (buf[i] + buf[i + 1] + buf[i + 2]) / 3
        n++
      }
    }
    return s / n
  }
  const PARK = { x: 1400, y: 20 }
  const at = async (x: number, y: number) => { await gp.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await sleep(80) }
  const shape = async (pathY: number) => {
    await at(PARK.x, PARK.y)
    for (const x of [120, 420, 720, 1020, 1320]) await at(x, pathY)   // 五枚点间距 300px ≈ 2σ，各亮各的
    await at(PARK.x, PARK.y)
    await sleep(600)                     // uPointer 按 1/8 秒平滑，600ms 后条带对指针的响应已走完 99%
    const f = await px(await grab(FULL))
    void pathY
    return meanBand(f, MID[0], MID[1]) - meanBand(f, FLANK[0][0], FLANK[0][1]) / 2 - meanBand(f, FLANK[1][0], FLANK[1][1]) / 2
  }
  const through: number[] = []
  const around: number[] = []
  for (const first of [true, false, true, false, true, false, true, false, true, false, true, false] as const) {
    await at(PARK.x, PARK.y)
    await sleep(3000)                     // 3.3 个时间常数，上一趟的尾只剩 3.7%
    ;(first ? through : around).push(await shape(first ? 450 : 200))
  }
  // 统计量用「相邻一对的差」的中位数，不用两组均值之差：呼吸那 ±10 个单位是随相位漂的共模残差，
  // 单趟能把它整个吃掉（10-08 实测四趟散布 12.2↔29.4），相邻两趟隔 3.6 秒、相位几乎相同，
  // 差掉之后取中位数，坏相位只能污染一对，打不动六对。
  const pairsHW = through.map((v, i) => v - around[i])
  const sortedPairs = [...pairsHW].sort((a, b) => a - b)
  const wake = sortedPairs.length % 2 === 0
    ? (sortedPairs[sortedPairs.length / 2 - 1] + sortedPairs[sortedPairs.length / 2]) / 2
    : sortedPairs[(sortedPairs.length - 1) / 2]
  // 噪声按"绕过去"那一列的标准误算，不是按单次最大幅度：这条比的是配对差。
  const sd = Math.sqrt(around.reduce((a, v) => a + (v - mean(around)) ** 2, 0) / around.length)
  const se = sd / Math.sqrt(around.length)
  check(wake >= 6 && wake >= se * 3,
    `H56 指针划过真的留下会衰减的亮尾（同一帧里"中间行 减 上下各 250px 两条对照行"的高通差，${pairsHW.length} 对相邻配对：${pairsHW.map((v) => v.toFixed(1)).join('、')} ⇒ 中位拖尾 ${wake.toFixed(1)}；对照那一列的标准误 ${se.toFixed(1)}，要 ≥6 且 ≥3× 它）`)

  // 文字压在实际画出来的像素上，getComputedStyle 那套取不到着色器，只能量图。
  const h1b = JSON.parse(String(await evalJs(gp, `(() => { const r = document.querySelector('h1').getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }) })()`)))
  const ink = await sharp(await grab(h1b)).grayscale().raw().toBuffer()
  const L = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  const sorted = [...ink].sort((a, b) => a - b)
  const dark = sorted[Math.floor(sorted.length * 0.1)]
  const light = sorted[Math.floor(sorted.length * 0.9)]
  const ratio = (Math.max(L(dark), L(light)) + 0.05) / (Math.min(L(dark), L(light)) + 0.05)
  check(ratio >= 4.5, `H46 主标题压在画出来的背景上仍有 ${ratio.toFixed(2)}:1（底 10% 分位 ${dark}、字 90% 分位 ${light}）`)
  await gp.s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await gp.s('Page.navigate', { url: `${BASE}/` })
  await waitFor(gp, `document.querySelector('canvas')`, 60_000)
  await sleep(1500)
  const r1 = await grab(FULL)
  await sleep(1200)
  const r2 = await grab(FULL)
  const drift = diff(await px(r1), await px(r2))
  check(drift === 0, 'H47 减少动效时整屏一帧不漂（两帧逐字节相同，rAF 根本没起）', `→ 平均通道差 ${drift.toFixed(3)}`)
  // 拖尾是动效的一部分：reduce 档指针再怎么划都不许在画布上留东西（监听根本没挂上才算数）。
  const before = await grab(FULL)
  for (const [fx, fy] of [[0.06, 0.2], [0.3, 0.45], [0.52, 0.7], [0.78, 0.5], [0.42, 0.85], [0.1, 0.3]] as const) {
    await gp.s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(1440 * fx), y: Math.round(900 * fy) })
    await sleep(90)
  }
  await sleep(500)
  const trailDrift = diff(await px(before), await px(await grab(FULL)))
  check(trailDrift === 0, 'H57 减少动效档指针划过也不留拖尾（整屏两帧逐字节相同）', `→ 平均通道差 ${trailDrift.toFixed(3)}`)
  await closePage(gp)

} finally {
  ws?.close()
  chrome?.kill()
  gpuChrome?.kill()
  await sleep(1200)
  rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  rmSync(gpuDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
}

console.log(failures.length === 0 ? '\n全部 PASS' : `\n失败 ${failures.length} 条：\n  ${failures.join('\n  ')}`)
process.exit(failures.length === 0 ? 0 : 1)
