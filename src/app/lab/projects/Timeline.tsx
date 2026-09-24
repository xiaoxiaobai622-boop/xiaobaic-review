'use client'

import { useMemo, useState } from 'react'
import { LAB_NOW, LAB_PROJECTS, LAB_TOTALS, mmdd, relative, type LabProject } from './fixture'

const SPANS = { d56: 56, d28: 28, d14: 14 } as const
type Span = keyof typeof SPANS
const DAY_W: Record<Span, number> = { d56: 21, d28: 34, d14: 62 }
const GUT = 250

const BINS = [
  { id: 'all', label: '全部' },
  { id: 'hot', label: '有新批注' },
  { id: 'unset', label: '零已定' },
  { id: 'idle', label: '沉默 14 天' },
  { id: 'big', label: '百集以上' },
] as const

type Bin = (typeof BINS)[number]['id']
type DayCell = { upload: number; note: number }

function indexActivity(p: LabProject, span: number): DayCell[] {
  const cells: DayCell[] = Array.from({ length: span }, () => ({ upload: 0, note: 0 }))
  for (const e of p.activity) {
    const d = -e.day
    if (d < 0 || d >= span) continue
    if (e.kind === 'upload') cells[d].upload += e.count
    else cells[d].note += e.count
  }
  return cells
}

function lastUploadAgo(p: LabProject) {
  const ds = p.activity.filter((e) => e.kind === 'upload').map((e) => -e.day)
  return ds.length ? Math.min(...ds) : 999
}

function weekdayCn(d: Date) {
  return ['日', '一', '二', '三', '四', '五', '六'][d.getUTCDay()]
}

function dateOf(i: number, days: number) {
  return new Date(LAB_NOW - (days - 1 - i) * 86400000)
}

export default function Timeline() {
  const [span, setSpan] = useState<Span>('d56')
  const [bin, setBin] = useState<Bin>('all')
  const [cursor, setCursor] = useState<number | null>(null)
  const [pop, setPop] = useState<{ x: number; y: number; p: LabProject; d: DayCell; date: Date; ep: number } | null>(null)

  const days = SPANS[span]
  const dayW = DAY_W[span]
  const trackW = days * dayW

  const rows = useMemo(() => {
    const list = LAB_PROJECTS.filter((p) => {
      if (bin === 'hot') return p.openNotes > 40
      if (bin === 'unset') return p.approved === 0
      if (bin === 'big') return p.episodes.length >= 100
      if (bin === 'idle') return lastUploadAgo(p) > 14
      return true
    })
    return list
      .slice()
      .sort((a, b) => lastUploadAgo(a) - lastUploadAgo(b))
      .map((p) => ({ p, cells: indexActivity(p, days), idle: lastUploadAgo(p) > 14 }))
  }, [bin, days])

  const weekStarts = useMemo(() => {
    const out: { i: number; date: Date }[] = []
    for (let i = 0; i < days; i++) {
      const date = dateOf(i, days)
      if (date.getUTCDay() === 1) out.push({ i, date })
    }
    return out
  }, [days])

  const weekendBands = useMemo(() => {
    const out: { i: number; span: number }[] = []
    for (let i = 0; i < days; i++) {
      const wd = dateOf(i, days).getUTCDay()
      if (wd !== 0 && wd !== 6) continue
      const last = out[out.length - 1]
      if (last && last.i + last.span === i) last.span += 1
      else out.push({ i, span: 1 })
    }
    return out
  }, [days])

  const readout = useMemo(() => {
    const range = cursor === null ? Array.from({ length: Math.min(7, days) }, (_, k) => days - 1 - k) : [cursor]
    let upload = 0
    let note = 0
    let touched = 0
    for (const { cells } of rows) {
      let hit = false
      for (const i of range) {
        upload += cells[i].upload
        note += cells[i].note
        if (cells[i].upload || cells[i].note) hit = true
      }
      if (hit) touched += 1
    }
    return { upload, note, touched, date: cursor === null ? null : dateOf(cursor, days) }
  }, [cursor, rows, days])

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const rel = e.clientX - rect.left - GUT
    setCursor(rel < 0 || rel >= trackW ? null : Math.floor(rel / dayW))
  }

  return (
    <div className="tl">
      <header className="tl-head">
        <div className="tl-mark">
          <span className="tl-mark__cn">时间线</span>
          <span className="tl-mark__en">DELIVERY TIMELINE</span>
        </div>
        <div className="tl-tallies">
          <span className="tl-tally">
            <span className="tl-tally__n">{LAB_TOTALS.projects}</span>
            <span className="tl-tally__l">项目</span>
          </span>
          <span className="tl-tally">
            <span className="tl-tally__n">{LAB_TOTALS.episodes.toLocaleString('en-US')}</span>
            <span className="tl-tally__l">总集数</span>
          </span>
          <span className="tl-tally">
            <span className="tl-tally__n" data-tone="hot">{LAB_TOTALS.openNotes.toLocaleString('en-US')}</span>
            <span className="tl-tally__l">未处理批注</span>
          </span>
          <span className="tl-tally">
            <span className="tl-tally__n" data-tone="set">{rows.length}</span>
            <span className="tl-tally__l">当前视图</span>
          </span>
        </div>
        <div className="tl-tools">
          <div className="tl-bins" role="group" aria-label="筛选">
            {BINS.map((b) => (
              <button key={b.id} type="button" className="tl-bin" aria-pressed={bin === b.id} onClick={() => setBin(b.id)}>
                {b.label}
              </button>
            ))}
          </div>
          <div className="tl-bins" role="group" aria-label="时间跨度">
            {(Object.keys(SPANS) as Span[]).map((s) => (
              <button key={s} type="button" className="tl-bin" aria-pressed={span === s} onClick={() => setSpan(s)}>
                {SPANS[s]}天
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="tl-readout">
        <span>
          <b>
            {readout.date ? `${mmdd(readout.date)} 周${weekdayCn(readout.date)}` : '近 7 日 · 指针移过任一列查看当日'}
          </b>
        </span>
        <span>交付 <b>{readout.upload}</b> 集</span>
        <span>新增批注 <em>{readout.note}</em> 条</span>
        <span>涉及 <b>{readout.touched}</b> 个项目</span>
        <span style={{ marginLeft: 'auto' }}>排序：最近交付优先 · 淡色 = 14 天无交付</span>
      </div>

      <div className="tl-scroll">
        <div
          className="tl-canvas"
          style={{ ['--track' as never]: `${trackW}px` } as React.CSSProperties}
          onMouseMove={onMove}
          onMouseLeave={() => setCursor(null)}
        >
          <div className="tl-rule">
            <div className="tl-rule__cap">项目 / 交付日期</div>
            <div className="tl-rule__track">
              {weekendBands.map((b) => (
                <div key={b.i} className="tl-band" style={{ left: b.i * dayW, width: b.span * dayW }} />
              ))}
              {weekStarts.map((w) => (
                <div key={w.i} className="tl-tick" style={{ left: w.i * dayW, width: dayW * 7 }}>
                  {mmdd(w.date)}
                </div>
              ))}
            </div>
          </div>

          {cursor !== null && (
            <div className="tl-head__cursor" style={{ left: GUT + cursor * dayW, top: 0, bottom: 0 }} />
          )}
          <div className="tl-play" style={{ left: GUT + trackW - dayW / 2 }} />

          {rows.map(({ p, cells, idle }) => (
            <div key={p.code} className="tl-lane" data-off={idle ? '1' : undefined}>
              <div className="tl-gut" title={`${p.title} · ${relative(p.updatedAt)}`}>
                <div className="tl-gut__top">
                  <span className="tl-gut__code">{p.code}</span>
                  <span className="tl-gut__title">{p.title}</span>
                </div>
                <div className="tl-gut__meta">
                  <span data-hot={p.openNotes ? '1' : undefined}>{p.openNotes} 未处理</span>
                  <span data-set={p.approved ? '1' : undefined}>已定 {p.approved}/{p.episodes.length}</span>
                  <span>{relative(p.updatedAt)}</span>
                </div>
              </div>
              <div className="tl-track">
                <div className="tl-base" />
                {cells.map((c, i) => {
                  if (!c.upload && !c.note) return null
                  return (
                    <span key={i} style={{ position: 'absolute', left: i * dayW, top: 0, bottom: 0, width: dayW }}>
                      {c.upload > 0 && (
                        <span
                          className="tl-clip"
                          data-late={i < days - 14 ? '1' : undefined}
                          style={{ left: 1, width: Math.max(3, dayW - 3), height: 5 + c.upload * 5 }}
                          onMouseEnter={(e) =>
                            setPop({
                              x: e.clientX,
                              y: e.clientY,
                              p,
                              d: c,
                              date: dateOf(i, days),
                              ep: Math.min(p.episodes.length, i + 1),
                            })
                          }
                          onMouseLeave={() => setPop(null)}
                        />
                      )}
                      {c.note > 0 && (
                        <span className="tl-pin" style={{ left: dayW / 2 - 1, opacity: Math.min(1, 0.3 + c.note / 12) }} />
                      )}
                    </span>
                  )
                })}
              </div>
            </div>
          ))}

          {!rows.length && <div className="tl-empty">该筛选下没有项目 · 换一个条件</div>}
        </div>
      </div>

      {pop && (
        <div
          className="tl-pop"
          style={{
            left: Math.min(pop.x + 14, window.innerWidth - 224),
            top: Math.min(pop.y + 12, window.innerHeight - 216),
          }}
        >
          <img src={`/api/lab/frame/${pop.p.episodes[pop.ep % pop.p.episodes.length].thumb}`} alt="" />
          <div className="tl-pop__body">
            <b>{pop.p.title}</b> · {pop.p.code}
            <br />
            {mmdd(pop.date)} 周{weekdayCn(pop.date)}
            <br />
            交付 <b>{pop.d.upload}</b> 集 · 批注 <b>{pop.d.note}</b> 条
          </div>
        </div>
      )}
    </div>
  )
}
