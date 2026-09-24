/**
 * Sample dataset for the /lab projects page.
 * Shape mirrors production (Project -> Video -> Comment); the numbers are
 * synthetic so the layout can be judged at ~50 projects / 181 episodes,
 * which the local database cannot produce.
 */

export type Episode = {
  n: number
  version: number
  approved: boolean
  openNotes: number
  duration: number
  thumb: number
}

export type DayEvent = { day: number; kind: 'upload' | 'note'; count: number }

export type LabProject = {
  code: string
  title: string
  episodes: Episode[]
  comments: number
  approved: number
  openNotes: number
  maxVersion: number
  updatedAt: number
  activity: DayEvent[]
  groupId: string
}

/**
 * Admin-made working folders for projects — one parent per project, one level.
 * The product already has this shape for videos inside a project
 * (ProjectFolder), but not for projects themselves, so it is invented here.
 */
export type LabGroup = { id: string; name: string; tone: 'work' | 'archive' }

export const UNFILED = 'g-unfiled'

export const LAB_GROUPS: LabGroup[] = [
  { id: 'g-split', name: '分账项目', tone: 'work' },
  { id: 'g-custom', name: '定制剧', tone: 'work' },
  { id: 'g-volume', name: '走量代剪', tone: 'work' },
  { id: 'g-restart', name: '待重启', tone: 'work' },
  { id: 'g-archive', name: '已交付存档', tone: 'archive' },
]

export const GROUP_NAMES: Record<string, string> = {
  [UNFILED]: '散件',
  ...Object.fromEntries(LAB_GROUPS.map((g) => [g.id, g.name])),
}

const THUMB_COUNT = 16

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const DAY = 86400000
const HOUR = 3600000
const NOW = Date.UTC(2026, 8, 23, 12, 0, 0)

type Spec = {
  code: string
  title: string
  eps: number
  maxVersion: number
  comments: number
  approved: number
  ago: number
  clear?: boolean
  group?: string
}

const SPECS: Spec[] = [
  { code: '2041', title: '黑手党', eps: 181, maxVersion: 5, comments: 184, approved: 12, ago: 2 * HOUR, group: 'g-custom' },
  { code: '2044', title: '月圆之吻-分账项目', eps: 38, maxVersion: 1, comments: 92, approved: 0, ago: 26 * HOUR, group: 'g-split' },
  { code: '2049', title: "TheAlphaWolf'sCaptiveHiddenPup", eps: 40, maxVersion: 2, comments: 312, approved: 33, ago: 6 * DAY, group: 'g-volume' },
  { code: '2055', title: '测试项目（勿动）', eps: 19, maxVersion: 5, comments: 8, approved: 4, ago: 3 * DAY, group: 'g-restart' },
]

const TITLES = [
  '夜上海', '山海契约', '无名者', '长夜将尽', '归途', '凤鸣朝', '断简残编', '浮城',
  '逆光而来', '第九封告别信', '雾都疑云', '少帅的替嫁新娘', '晚风知我意', '藏锋', '春夜宴',
  '铁轨尽头', '模拟信号', '第七家当铺', '荒原纪事', '薄冰', '孤注', '拾光者', '雷霆书院',
  '南辕北辙', '旧城少年', '无人接听', '零点班车', '纸飞机', '深海电台', '白色契约', '半醒',
  '长安醉', '末日小卖部', '替身演员', '寒鸦', '第七封信', '逆风少年', '荒岛日记', ' midnight diners',
  '霓虹旅人', '影子护卫', '过期承诺', '小城大事', '夜航船', '明日之后', '沙漏之城', '归雁',
]

function pickGroup(roll: number): string {
  if (roll < 0.26) return 'g-custom'
  if (roll < 0.46) return 'g-volume'
  if (roll < 0.58) return 'g-split'
  if (roll < 0.7) return 'g-restart'
  return UNFILED
}

for (let i = 0; i < TITLES.length; i++) {
  const r = mulberry32(1000 + i * 7919)
  const ago = Math.floor(r() * 40) * DAY + Math.floor(r() * 20) * HOUR
  // Anything untouched for over a month is a closed delivery: nothing pending.
  const clear = ago > 28 * DAY
  const roll = r()
  SPECS.push({
    code: String(2060 + i * 3),
    title: TITLES[i].trim(),
    eps: 12 + Math.floor(r() * 90),
    maxVersion: 1 + Math.floor(r() * 4),
    comments: Math.floor(r() * 220),
    approved: 0,
    ago,
    clear,
    group: clear ? (roll < 0.8 ? 'g-archive' : UNFILED) : pickGroup(roll),
  })
}

function buildProject(spec: Spec, seed: number): LabProject {
  const r = mulberry32(seed)
  const episodes: Episode[] = []
  let openNotes = 0

  for (let n = 1; n <= spec.eps; n++) {
    const version = 1 + Math.floor(r() * spec.maxVersion)
    const approved = spec.clear || n <= spec.approved
    const noisy = r() < (spec.comments / spec.eps > 2 ? 0.55 : 0.22)
    const notes = approved ? 0 : noisy ? 1 + Math.floor(r() * 4) : 0
    openNotes += notes
    episodes.push({
      n,
      version: approved ? spec.maxVersion : Math.min(version, spec.maxVersion),
      approved,
      openNotes: notes,
      duration: 78 + Math.floor(r() * 62),
      thumb: Math.floor(r() * THUMB_COUNT),
    })
  }

  const activity: DayEvent[] = []
  for (let d = 0; d < 56; d++) {
    const age = d / 56
    if (r() < 0.34 + (1 - age) * 0.2) {
      activity.push({ day: -d, kind: 'upload', count: 1 + Math.floor(r() * Math.min(6, spec.maxVersion * 2)) })
    }
    if (r() < 0.42) {
      activity.push({ day: -d, kind: 'note', count: 1 + Math.floor(r() * (spec.comments / 24)) })
    }
  }

  return {
    code: spec.code,
    title: spec.title,
    episodes,
    comments: spec.comments,
    approved: spec.clear ? spec.eps : spec.approved,
    openNotes: openNotes || (spec.clear ? 0 : Math.round(spec.comments * 0.6)),
    maxVersion: spec.maxVersion,
    updatedAt: NOW - spec.ago,
    activity,
    groupId: spec.group ?? UNFILED,
  }
}

export const LAB_PROJECTS: LabProject[] = SPECS.map((s, i) => buildProject(s, 4242 + i * 104729))

export const LAB_TOTALS = {
  projects: LAB_PROJECTS.length,
  episodes: LAB_PROJECTS.reduce((a, p) => a + p.episodes.length, 0),
  openNotes: LAB_PROJECTS.reduce((a, p) => a + p.openNotes, 0),
  comments: LAB_PROJECTS.reduce((a, p) => a + p.comments, 0),
}

export type GroupSummary = {
  n: number
  episodes: number
  openNotes: number
  approved: number
  /** Newest updatedAt in the group, 0 when the group is empty. */
  latest: number
}

export function summarize(list: LabProject[]): GroupSummary {
  return {
    n: list.length,
    episodes: list.reduce((a, p) => a + p.episodes.length, 0),
    openNotes: list.reduce((a, p) => a + p.openNotes, 0),
    approved: list.reduce((a, p) => a + p.approved, 0),
    latest: list.reduce((a, p) => Math.max(a, p.updatedAt), 0),
  }
}

export const LAB_NOW = NOW
export const LAB_THUMB_COUNT = THUMB_COUNT

export function timecode(seconds: number, fps = 25) {
  const s = Math.floor(seconds)
  const f = Math.floor((seconds - s) * fps)
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(f)}`
}

export function relative(iso: number) {
  const diff = NOW - iso
  if (diff < HOUR) return `${Math.max(1, Math.round(diff / 60000))} 分钟前`
  if (diff < DAY) return `${Math.round(diff / HOUR)} 小时前`
  if (diff < 2 * DAY) return '昨天'
  if (diff < 30 * DAY) return `${Math.round(diff / DAY)} 天前`
  return `${Math.round(diff / (30 * DAY))} 个月前`
}

/** Categories mirror src/lib/comment-categories.ts so the labels stay truthful. */
export type LabNote = {
  ep: number
  at: number
  cat: '画面' | '声音' | '字幕' | '剪辑' | '其他'
  color: string
  text: string
  author: string
  ago: number
}

const NOTE_SEEDS: Array<{ cat: LabNote['cat']; color: string; text: string; author: string }> = [
  { cat: '字幕', color: '#8b6fc4', text: '这版字幕压到下黑边了，整体上抬 40 像素', author: '字幕组' },
  { cat: '画面', color: '#4a90c0', text: '开场第二个镜头色调偏青，和前后不接', author: '审片 A' },
  { cat: '声音', color: '#c9903c', text: 'BGM 盖住对白，人声再抬 2dB', author: '混音组' },
  { cat: '剪辑', color: '#3f9d76', text: '转场多留了一帧，画面闪了一下', author: '剪辑组' },
  { cat: '其他', color: '#7d8087', text: '片尾品牌标版要留满 3 秒', author: '客户方' },
  { cat: '字幕', color: '#8b6fc4', text: '第 12 分钟的人名打错了，改成「沈」', author: '客户方' },
  { cat: '画面', color: '#4a90c0', text: '这段手持太晃，客户希望换备用条', author: '审片 B' },
  { cat: '声音', color: '#c9903c', text: '环境声在第 3 分钟突然断了', author: '混音组' },
]

export function notesFor(p: LabProject): LabNote[] {
  const r = mulberry32(p.code.length * 9173 + p.episodes.length)
  const flagged = p.episodes.filter((e) => e.openNotes > 0)
  const pool = flagged.length ? flagged : p.episodes
  const count = Math.min(6, Math.max(3, p.episodes.length))
  const out: LabNote[] = []
  for (let i = 0; i < count; i++) {
    const s = NOTE_SEEDS[Math.floor(r() * NOTE_SEEDS.length)]
    const ep = pool[Math.floor(r() * pool.length)]
    out.push({
      ep: ep.n,
      at: Math.floor(r() * ep.duration * 0.9),
      cat: s.cat,
      color: s.color,
      text: s.text,
      author: s.author,
      ago: Math.floor(r() * 14) * DAY + Math.floor(r() * 22) * HOUR,
    })
  }
  return out.sort((a, b) => b.ago - a.ago)
}

export function dayOf(offset: number) {
  return new Date(NOW + offset * DAY)
}

export function mmdd(d: Date) {
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}
