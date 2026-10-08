import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/encryption'

/**
 * 首页那两张配图（public/home/review-ui.png、review-comments.png）是从本地演示数据截的，
 * 结果把「百度网盘同步空间」的广告片、PREVIEW-111 水印和 Admin 随手敲的「ces / 1 / 2」
 * 一起烧进了公网营销图。这里造一条干净的替代素材：一支真能播的片子＋五条读得通的中文批注，
 * 停在审片页就能截。
 *
 * 只写本地库和本地 uploads（STORAGE_PROVIDER=local）；生产碰不到。
 * 可重跑：全部按固定标识 upsert，不会越跑越多。
 * 口令走 HOME_DEMO_PASSWORD；没设就现生成一枚、只打在标准输出，不落文件。
 */
const prisma = new PrismaClient()
const EMAIL = 'home-demo@xiaobaic.local'
const TEAM_SLUG = 'home-demo'
const PROJECT_TITLE = '屿见 · 城市夜景品牌片'
const VIDEO_NAME = '屿见_城市夜景_定稿'
const VIDEO_VERSION = 3
/** 收录短链的码不进文件：给了环境变量就用它，否则复用这个项目上已有的那一枚，
 *  都没有才现随机一枚 —— 三条路都指向同一枚，脚本重跑走 upsert 不堆行。 */
const DEMO_COLLECT_FROM_ENV = process.env.HOME_DEMO_COLLECT_TOKEN || ''
const SOURCE_CLIP = 'public/home/film-set.mp4'
const STORAGE_ROOT = process.env.STORAGE_ROOT || './uploads'
/** 与 src/lib/platform-access.ts 的 BETA_QUOTA 同口径（那枚文件第一行 import Prisma，这里不引）。 */
const BETA_QUOTA = { maxMembers: 5, maxProjects: 0, maxVideos: 0, maxStorageGB: 10 }

function sh(file: string, args: string[]) {
  return execFileSync(file, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
}
function ffprobeJson(file: string) {
  const out = sh('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height,r_frame_rate,codec_name:format=duration', '-of', 'json', file])
  const j = JSON.parse(out)
  const [num, den] = String(j.streams?.[0]?.r_frame_rate || '24/1').split('/')
  return {
    width: Number(j.streams?.[0]?.width),
    height: Number(j.streams?.[0]?.height),
    fps: Number(num) / Number(den),
    codec: j.streams?.[0]?.codec_name || 'h264',
    duration: Number(j.format?.duration),
  }
}
/** 批注时间码：秒 → HH:MM:SS:FF，帧按片子真实 fps 取整（界面就是这么排的）。 */
const tc = (sec: number, fps: number) => {
  const total = Math.round(sec * fps)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(Math.floor(total / (3600 * fps)))}:${p(Math.floor(total / (60 * fps)) % 60)}:${p(Math.floor(total / fps) % 60)}:${p(total % fps)}`
}

async function main() {
  const generated = !process.env.HOME_DEMO_PASSWORD
  const password = process.env.HOME_DEMO_PASSWORD || randomBytes(9).toString('base64url')

  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { name: '白浪', password: await hashPassword(password) },
    create: {
      email: EMAIL, name: '白浪', username: 'home-demo', password: await hashPassword(password),
      phone: '13700000000', role: 'ADMIN',
    },
  })

  const team = await prisma.team.upsert({
    where: { slug: TEAM_SLUG },
    update: { name: '海平面影视', createdById: user.id },
    create: {
      name: '海平面影视', slug: TEAM_SLUG, shareKey: `tm_${randomBytes(5).toString('hex')}`,
      createdById: user.id, subscriptionPlan: 'BETA', subscriptionExpiresAt: null,
    },
  })
  await prisma.teamMember.upsert({
    where: { teamId_userId: { teamId: team.id, userId: user.id } },
    update: { role: 'OWNER', status: 'ACTIVE', teamProfession: '后期总监' },
    create: { teamId: team.id, userId: user.id, role: 'OWNER', status: 'ACTIVE', teamProfession: '后期总监' },
  })
  await prisma.teamQuota.upsert({
    where: { teamId: team.id },
    update: { ...BETA_QUOTA, source: 'PLAN' },
    create: { teamId: team.id, ...BETA_QUOTA, source: 'PLAN' },
  })

  const existing = await prisma.project.findFirst({ where: { teamId: team.id, title: PROJECT_TITLE } })
  const project = existing
    ? await prisma.project.update({ where: { id: existing.id }, data: { authMode: 'NONE', watermarkEnabled: false } })
    : await prisma.project.create({
      data: {
        projectCode: '001', title: PROJECT_TITLE, slug: `hd-${randomBytes(6).toString('hex')}`,
        shareSlug: `HD${randomBytes(4).toString('hex').toUpperCase()}`, companyName: '屿见文化',
        description: '城市夜景品牌片定稿审阅', authMode: 'NONE', status: 'IN_REVIEW',
        watermarkEnabled: false, teamId: team.id, createdById: user.id,
      },
    })

  // 演示片换成三枚 1920×1080 真片：Mixkit 免费商用授权（https://mixkit.co/license/#videoFree，
  // 无需署名）。源片落在 git 忽略的 uploads/marketing-src/ 下，仓库里不留几十兆的二进制；
  // 找不到就退回仓库自带那枚 960×506 模板片——能跑，但首页配图会糊成马赛克。
  const CLIP_SOURCES: Record<string, string> = {
    night: 'uploads/marketing-src/night-city-aerial.mp4',
    set: 'uploads/marketing-src/set-behind-scenes.mp4',
    dusk: 'uploads/marketing-src/dusk-drone.mp4',
  }
  const videoDir = join(STORAGE_ROOT, 'teams', team.id, 'projects', project.id, 'videos')
  mkdirSync(videoDir, { recursive: true })

  type Clip = { key: string; file: string; meta: { duration: number; width: number; height: number; fps: number; codec: string } }
  async function prepareClip(name: string, src: string): Promise<Clip> {
    const key = `teams/${team.id}/projects/${project.id}/videos/original-${name}.mp4`
    const file = join(STORAGE_ROOT, key)
    // 一枚 1080p 片子转一遍要几分钟，源片没变就别重转。
    if (existsSync(file) && statSync(file).mtimeMs > statSync(src).mtimeMs) {
      return { key, file, meta: ffprobeJson(file) }
    }
    const srcMeta = ffprobeJson(src)
    if (srcMeta.width < 1900) {
      console.log(`⚠️ ${src} 只有 ${srcMeta.width}×${srcMeta.height}，放大到 1920 必然发糊——首页配图的高清上限就在这枚源片上`)
    }
    sh('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', 'scale=1920:-2:flags=lanczos,fps=24',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-movflags', '+faststart', file])
    return { key, file, meta: ffprobeJson(file) }
  }
  const clips: Record<string, Clip> = {}
  for (const [name, src] of Object.entries(CLIP_SOURCES)) {
    clips[name] = await prepareClip(name, existsSync(src) ? src : SOURCE_CLIP)
  }

  // 素材网格要像真项目：12 条素材分给三枚片子，同名排 v1/v2/v3，缩略图各取一个时间点。
  // at 是「占片长比例」而不是秒数：三枚片子时长差三倍（43.75 / 14.4 / 12.6 秒），
  // 写死秒数会取到片尾淡出的黑帧，卡片就成了一块黑板。
  const ASSETS: { name: string; clip: keyof typeof CLIP_SOURCES; versions: { v: number; at: number }[] }[] = [
    { name: VIDEO_NAME, clip: 'night', versions: [{ v: 1, at: 0.046 }, { v: 2, at: 0.16 }, { v: VIDEO_VERSION, at: 0.091 }] },
    { name: '屿见_城市夜景_横版', clip: 'night', versions: [{ v: 1, at: 0.274 }, { v: 2, at: 0.366 }] },
    { name: '屿见_预告片_30s', clip: 'night', versions: [{ v: 1, at: 0.434 }, { v: 2, at: 0.526 }] },
    { name: '屿见_城市夜景_无人机', clip: 'dusk', versions: [{ v: 1, at: 0.069 }, { v: 2, at: 0.183 }] },
    { name: '屿见_导演剪辑_加长版', clip: 'dusk', versions: [{ v: 1, at: 0.251 }, { v: 2, at: 0.297 }] },
    { name: '客户反馈_调色参考', clip: 'dusk', versions: [{ v: 1, at: 0.137 }] },
    { name: '片场花絮_灯位记录', clip: 'set', versions: [{ v: 1, at: 0.069 }, { v: 2, at: 0.206 }] },
    { name: '录音棚_补录花絮', clip: 'set', versions: [{ v: 1, at: 0.137 }] },
    { name: '屿见_城市夜景_竖版', clip: 'night', versions: [{ v: 1, at: 0.754 }] },
    { name: '屿见_主视觉_静帧', clip: 'night', versions: [{ v: 1, at: 0.114 }] },
    { name: '客户反馈_字幕版', clip: 'night', versions: [{ v: 1, at: 0.594 }, { v: 2, at: 0.686 }] },
    { name: '屿见_片尾字幕_走查', clip: 'night', versions: [{ v: 1, at: 0.64 }] },
  ]

  let main: { row: { id: string }; clip: Clip } | null = null
  for (const asset of ASSETS) {
    const clip = clips[asset.clip]
    const base = {
      originalFileName: `${asset.name}.mov`, originalFileSize: BigInt(statSync(clip.file).size),
      originalStoragePath: clip.key, fileType: 'video/mp4',
      uploadedBy: user.id, uploadedByName: user.name ?? undefined,
      duration: clip.meta.duration, width: clip.meta.width, height: clip.meta.height,
      fps: clip.meta.fps, codec: clip.meta.codec, status: 'READY' as const, approved: false,
    }
    for (const { v, at } of asset.versions) {
      const where = { projectId_name_version: { projectId: project.id, name: asset.name, version: v } }
      const row = await prisma.video.upsert({
        where,
        update: { ...base, version: v, versionLabel: `v${v}` },
        create: { projectId: project.id, name: asset.name, version: v, versionLabel: `v${v}`, ...base },
      })
      const dir = join(videoDir, row.id)
      mkdirSync(dir, { recursive: true })
      const dur = clip.meta.duration
      // 片头淡入、片尾淡出都是黑帧，写死一个时间点就会截出黑板：
      // 在整片 10%–90% 之间均分八个候选点，取最亮那张，同分时用排得靠前的（保住素材之间的差异）。
      const sharp = (await import('sharp')).default
      const thumb = join(dir, 'thumbnail.jpg')
      const span = 0.8
      const picks = [at, ...Array.from({ length: 8 }, (_, k) => 0.1 + span * (k / 7))]
      let best = -1
      for (const [i, frac] of picks.entries()) {
        const sec = Math.min(Math.max(dur * Math.min(0.95, Math.max(0.05, frac)), 0.4), dur - 0.6)
        const probe = join(dir, `probe-${i}.jpg`)
        sh('ffmpeg', ['-v', 'error', '-y', '-ss', sec.toFixed(2), '-i', clip.file, '-frames:v', '1', '-q:v', '2', probe])
        const mean = (await sharp(probe).grayscale().stats()).channels[0].mean
        // 只有明显更亮（+8）才换掉前一张，否则保留靠前的时间点
        if (mean > best + 8) { best = mean; rmSync(thumb, { force: true }); execFileSync('mv', [probe, thumb]) } else rmSync(probe, { force: true })
      }
      await prisma.video.update({ where: { id: row.id }, data: { thumbnailPath: `${clip.key.replace(/original-[^/]+\.mp4$/, '')}${row.id}/thumbnail.jpg` } })
      if (asset.name === VIDEO_NAME && v === VIDEO_VERSION) main = { row, clip }
    }
  }
  if (!main) throw new Error('演示素材没建起来')
  const video = main.row
  const meta = main.clip.meta
  const thumbPrefix = `${main.clip.key.replace(/original-[^/]+\.mp4$/, '')}${video.id}/thumbnail.jpg`

  const COMMENTS = [
    { sec: 3.5, name: '白浪', category: 'EDITING', internal: true, content: '片头字幕起早了，楼群还没进画就压上来，往后挪 12 帧。' },
    { sec: 11.25, name: '陈屿', category: 'PICTURE', internal: false, resolved: true, content: '这段调色偏品红，霓虹和车灯那一片照 v2 再走一遍。' },
    { sec: 13.5, name: '白浪', category: 'PICTURE', internal: true, replyTo: 1, content: '收到，按 v2 的品红重出一版，今晚发你确认。' },
    { sec: 19.8, name: '李声', category: 'AUDIO', internal: true, content: '环境声有一层底噪，这一段车流最明显，麻烦补一轨。' },
    { sec: 31.3, name: '赵一', category: 'OTHER', internal: false, content: '片尾 logo 停留加到 2 秒，现在刚读完品牌名就切了。' },
  ]
  await prisma.comment.deleteMany({ where: { videoId: video.id } })
  const made: string[] = []
  for (const c of COMMENTS) {
    const created = await prisma.comment.create({
      data: {
        projectId: project.id, videoId: video.id, videoVersion: VIDEO_VERSION,
        timecode: tc(c.sec, meta.fps), content: c.content, authorName: c.name,
        category: c.category, isInternal: c.internal, resolved: Boolean(c.resolved),
        userId: c.internal ? user.id : null,
        ...(c.replyTo !== undefined ? { parentId: made[c.replyTo] } : {}),
      },
    })
    made.push(created.id)
  }

  // 首页「素材收录」那一行要能真打开一张收录页：建一条不要密码、只给上传权的收录短链。
  const hadCollect = await prisma.shareLink.findFirst({
    where: { projectId: project.id, type: 'COLLECT' }, select: { token: true }, orderBy: { createdAt: 'asc' },
  })
  const collectToken = DEMO_COLLECT_FROM_ENV || hadCollect?.token || randomBytes(4).toString('hex')
  const collectWhere = { token: collectToken }
  await prisma.shareLink.upsert({
    where: collectWhere,
    update: { projectId: project.id, name: '屿见 · 城市夜景回传', type: 'COLLECT', scopeType: 'PROJECT', scopeId: '', permissions: ['upload'], authMode: 'NONE', sharePassword: null, status: 'ACTIVE' },
    create: { token: collectToken, projectId: project.id, name: '屿见 · 城市夜景回传', type: 'COLLECT', scopeType: 'PROJECT', scopeId: '', permissions: ['upload'], authMode: 'NONE', status: 'ACTIVE' },
  })

  const assetCount = (await prisma.video.groupBy({ by: ['name'], where: { projectId: project.id } })).length
  const versionCount = await prisma.video.count({ where: { projectId: project.id } })

  console.log(JSON.stringify({
    projectUrl: `/studio/projects/${project.id}`, projectId: project.id, videoId: video.id,
    video: { name: VIDEO_NAME, ...meta, bytes: Number(statSync(main.clip.file).size) },
    assets: assetCount, versions: versionCount, collectUrl: `/${collectToken}`,
    comments: made.length, thumbKey: thumbPrefix,
    login: { email: EMAIL, ...(generated ? { password } : { password: '取自 HOME_DEMO_PASSWORD' }) },
  }, null, 1))
}

main().finally(() => prisma.$disconnect())
