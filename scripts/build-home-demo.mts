import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/encryption'

/**
 * 首页那两张配图（public/home/review-ui.png、comments-detail.png）是从本地演示数据截的，
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

  // 素材：仓库自带的营销循环片（public/home/film-set.mp4，已在仓库里公开过）拉到 1920 宽，
  // 免得截图里出现「960×506」这种一看就是测试件的分辨率。
  const videoDir = join(STORAGE_ROOT, 'teams', team.id, 'projects', project.id, 'videos')
  mkdirSync(videoDir, { recursive: true })
  const key = `teams/${team.id}/projects/${project.id}/videos/original-home-demo.mp4`
  const file = join(STORAGE_ROOT, 'teams', team.id, 'projects', project.id, 'videos', 'original-home-demo.mp4')
  sh('ffmpeg', ['-v', 'error', '-y', '-i', SOURCE_CLIP, '-vf', 'scale=1920:-2:flags=lanczos,fps=24',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-movflags', '+faststart', file])
  const meta = ffprobeJson(file)

  const videoData = {
    version: VIDEO_VERSION, versionLabel: `v${VIDEO_VERSION}`,
    originalFileName: `${VIDEO_NAME}.mov`, originalFileSize: BigInt(statSync(file).size),
    originalStoragePath: key, fileType: 'video/mp4',
    uploadedBy: user.id, uploadedByName: user.name ?? undefined,
    duration: meta.duration, width: meta.width, height: meta.height, fps: meta.fps, codec: meta.codec,
    status: 'READY' as const, approved: false,
  }
  const video = await prisma.video.findUnique({ where: { projectId_name_version: { projectId: project.id, name: VIDEO_NAME, version: VIDEO_VERSION } } })
    ? await prisma.video.update({
      where: { projectId_name_version: { projectId: project.id, name: VIDEO_NAME, version: VIDEO_VERSION } },
      data: videoData,
    })
    : await prisma.video.create({ data: { projectId: project.id, name: VIDEO_NAME, ...videoData } })

  // 缩略图给素材卡用；没有它卡片会退成一枚图标。
  const thumbDir = join(videoDir, video.id)
  mkdirSync(thumbDir, { recursive: true })
  sh('ffmpeg', ['-v', 'error', '-y', '-ss', '4', '-i', file, '-frames:v', '1', '-q:v', '2', join(thumbDir, 'thumbnail.jpg')])
  await prisma.video.update({ where: { id: video.id }, data: { thumbnailPath: `${key.replace('original-home-demo.mp4', '')}${video.id}/thumbnail.jpg` } })

  const COMMENTS = [
    { sec: 3.5, name: '白浪', category: 'EDITING', internal: true, content: '片头字幕起早了，演员还没入画就压上来，往后挪 12 帧。' },
    { sec: 11.25, name: '陈屿', category: 'PICTURE', internal: false, resolved: true, content: '这段调色偏品红，肤色照 v2 那一版再走一遍。' },
    { sec: 13.5, name: '白浪', category: 'PICTURE', internal: true, replyTo: 1, content: '收到，按 v2 的肤色重出一版，今晚发你确认。' },
    { sec: 19.8, name: '李声', category: 'AUDIO', internal: true, content: '现场收音有空调底噪，这一句最明显，麻烦补一轨。' },
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

  console.log(JSON.stringify({
    projectUrl: `/studio/projects/${project.id}`, projectId: project.id, videoId: video.id,
    video: { name: VIDEO_NAME, ...meta, bytes: Number(videoData.originalFileSize) },
    comments: made.length, thumbKey: `${key.replace('original-home-demo.mp4', '')}${video.id}/thumbnail.jpg`,
    login: { email: EMAIL, ...(generated ? { password } : { password: '取自 HOME_DEMO_PASSWORD' }) },
  }, null, 1))
}

main().finally(() => prisma.$disconnect())
