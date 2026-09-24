'use client'

import { useMemo, useState } from 'react'
import { LAB_NOW, LAB_PROJECTS, LAB_TOTALS, notesFor, relative, timecode } from './fixture'

export default function ScreeningRoom() {
  const [code, setCode] = useState(LAB_PROJECTS[0].code)
  const index = LAB_PROJECTS.findIndex((p) => p.code === code)
  const p = LAB_PROJECTS[index]
  const [epN, setEpN] = useState(p.episodes[p.episodes.length - 1].n)
  const ep = p.episodes.find((e) => e.n === epN) ?? p.episodes[p.episodes.length - 1]
  const notes = useMemo(() => notesFor(p), [p])

  const pct = Math.round((p.approved / p.episodes.length) * 100)
  const recentUploads = p.activity.filter((e) => e.kind === 'upload' && e.day > -14).reduce((a, e) => a + e.count, 0)

  function pick(next: number) {
    const target = LAB_PROJECTS[(next + LAB_PROJECTS.length) % LAB_PROJECTS.length]
    setCode(target.code)
    setEpN(target.episodes[target.episodes.length - 1].n)
  }

  return (
    <div className="hs">
      <nav className="hs-strip" aria-label="片单">
        {LAB_PROJECTS.map((item, i) => (
          <button
            key={item.code}
            type="button"
            className="hs-cell"
            aria-current={i === index ? 'true' : undefined}
            onClick={() => pick(i)}
            title={`${item.title} · ${item.openNotes} 条未处理`}
          >
            <img src={`/api/lab/frame/${item.episodes[0].thumb}`} alt="" />
            <span className="hs-cell__code">{item.code}</span>
            <span className="hs-cell__title">{item.title}</span>
            {item.openNotes > 0 && <span className="hs-cell__punch" />}
          </button>
        ))}
      </nav>

      <section className="hs-stage">
        <div className="hs-crumb">
          <span className="hs-crumb__code">
            片 {String(index + 1).padStart(2, '0')} / {LAB_PROJECTS.length}
          </span>
          <h1 className="hs-crumb__title">{p.title}</h1>
          <span className="hs-crumb__no">NO.{p.code}</span>
          <span className="hs-crumb__nav">
            <button type="button" onClick={() => pick(index - 1)}>← 上一片</button>
            <button type="button" onClick={() => pick(index + 1)}>下一片 →</button>
          </span>
        </div>

        <div className="hs-frame">
          <img src={`/api/lab/frame/${ep.thumb}`} alt={`${p.title} 第 ${ep.n} 集`} />
          <span className="hs-frame__mark">REEL {String(ep.n).padStart(3, '0')}</span>
          <span className="hs-frame__burn">EP {String(ep.n).padStart(3, '0')} · v{ep.version}</span>
          <span className="hs-frame__tc">{timecode(ep.duration)}</span>
        </div>

        <div className="hs-perf">
          <div className="hs-perf__row">
            {p.episodes.map((e) => (
              <button
                key={e.n}
                type="button"
                className="hs-frame-cell"
                aria-current={e.n === ep.n ? 'true' : undefined}
                onClick={() => setEpN(e.n)}
                title={`第 ${e.n} 集 · ${e.approved ? '已定' : '待定'} · ${e.openNotes} 条未处理`}
              >
                <img src={`/api/lab/frame/${e.thumb}`} alt="" />
                <span className="hs-frame-cell__ep">{String(e.n).padStart(3, '0')}</span>
                {e.openNotes > 0 && <span className="hs-frame-cell__note">{e.openNotes}</span>}
              </button>
            ))}
          </div>
        </div>
      </section>

      <aside className="hs-side">
        <div className="hs-dial">
          <div className="hs-ring" style={{ ['--p' as never]: pct } as React.CSSProperties}>
            <span className="hs-ring__n">
              {pct}
              <small>%</small>
            </span>
          </div>
          <div className="hs-dial__txt">
            <span className="hs-dial__l">定 稿 进 度</span>
            <span className="hs-dial__v">{p.approved} / {p.episodes.length} 集</span>
            <span className="hs-dial__v" data-hot={p.openNotes ? '1' : undefined}>{p.openNotes} 条待处理</span>
          </div>
        </div>

        <div>
          <div className="hs-head">CUE SHEET · 本片</div>
          <div className="hs-cue">
            <div className="hs-cue__row"><span>最近更新</span><b>{relative(p.updatedAt)}</b></div>
            <div className="hs-cue__row"><span>版本跨度</span><b>v1 – v{p.maxVersion}</b></div>
            <div className="hs-cue__row"><span>批注总数</span><b>{p.comments}</b></div>
            <div className="hs-cue__row"><span>近 14 日交付</span><b>{recentUploads} 集</b></div>
            <div className="hs-cue__row"><span>全站未处理</span><b>{LAB_TOTALS.openNotes.toLocaleString('en-US')}</b></div>
          </div>
        </div>

        <div>
          <div className="hs-head">批注 · 样本内容</div>
          {notes.map((n, i) => (
            <div key={i} className="hs-note">
              <span className="hs-note__dot" style={{ background: n.color }} />
              <div>
                <div className="hs-note__txt">{n.text}</div>
                <div className="hs-note__meta">
                  <span data-ep={n.ep === ep.n ? '1' : undefined} data-cat={n.cat}>EP {String(n.ep).padStart(3, '0')}</span>
                  <span>{n.cat}</span>
                  <span>{timecode(n.at)}</span>
                  <span>{n.author}</span>
                  <span>{relative(LAB_NOW - n.ago)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  )
}
