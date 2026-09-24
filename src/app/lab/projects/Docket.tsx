'use client'

import { useMemo, useState } from 'react'
import { LAB_NOW, LAB_PROJECTS, LAB_TOTALS, relative, type LabProject } from './fixture'

const SORTS = [
  { id: 'open', label: '未处理↓' },
  { id: 'recent', label: '最近更新' },
  { id: 'eps', label: '集数↓' },
  { id: 'code', label: '编号' },
] as const
type Sort = (typeof SORTS)[number]['id']

const FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'open', label: '有待办' },
  { id: 'unset', label: '零已定' },
  { id: 'ready', label: '可交付' },
] as const
type Filter = (typeof FILTERS)[number]['id']

function lastUploadAgo(p: LabProject) {
  const ds = p.activity.filter((e) => e.kind === 'upload').map((e) => -e.day)
  return ds.length ? Math.min(...ds) : 999
}

function stampOf(p: LabProject) {
  if (p.openNotes === 0) return p.approved > 0 ? { text: '可 交 付', tone: 'ok' } : null
  if (p.openNotes >= 90) return { text: '加 急', tone: 'hot' }
  if (p.approved === 0) return { text: '初审待定', tone: 'hot' }
  return null
}

export default function Docket() {
  const [sort, setSort] = useState<Sort>('open')
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = LAB_PROJECTS.filter((p) => {
      if (needle && !`${p.code} ${p.title}`.toLowerCase().includes(needle)) return false
      if (filter === 'open') return p.openNotes > 0
      if (filter === 'unset') return p.approved === 0
      if (filter === 'ready') return p.openNotes === 0 && p.approved > 0
      return true
    })
    const by: Record<Sort, (a: LabProject, b: LabProject) => number> = {
      open: (a, b) => b.openNotes - a.openNotes,
      recent: (a, b) => lastUploadAgo(a) - lastUploadAgo(b),
      eps: (a, b) => b.episodes.length - a.episodes.length,
      code: (a, b) => a.code.localeCompare(b.code),
    }
    return list.slice().sort(by[sort])
  }, [sort, filter, q])

  const shownOpen = rows.reduce((a, p) => a + p.openNotes, 0)

  return (
    <div className="dk">
      <div className="dk-wrap">
        <div className="dk-rail" aria-hidden="true" />
        <div className="dk-sheet">
          <header className="dk-head">
            <div className="dk-head__row">
              <span className="dk-head__cn">交付台账</span>
              <span className="dk-head__en">DELIVERY DOCKET</span>
              <div className="dk-head__form">
                表单 NO. <b>PRJ-0923</b>
                <br />
                打印 {new Date(LAB_NOW).toISOString().slice(0, 16).replace('T', ' ')} · 共 {rows.length} 单
              </div>
            </div>
            <div className="dk-head__strip" aria-hidden="true">
              {'+= '.repeat(60)}
            </div>
          </header>

          <div className="dk-bar">
            <span className="dk-bar__k">检索</span>
            <input
              className="dk-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="编号或片名"
              aria-label="检索项目"
            />
            <span className="dk-bar__k">排序</span>
            {SORTS.map((s) => (
              <button key={s.id} type="button" className="dk-chip" aria-pressed={sort === s.id} onClick={() => setSort(s.id)}>
                {s.label}
              </button>
            ))}
            <span className="dk-bar__k">筛选</span>
            {FILTERS.map((f) => (
              <button key={f.id} type="button" className="dk-chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
            <span className="dk-bar__sum">
              本表未处理批注 <b>{shownOpen.toLocaleString('en-US')}</b> 条 · 全站 {LAB_TOTALS.openNotes.toLocaleString('en-US')} 条
            </span>
          </div>

          {rows.map((p) => {
            const stamp = stampOf(p)
            const isOpen = open === p.code
            const flagged = p.episodes.filter((e) => e.openNotes > 0)
            return (
              <div key={p.code} className="dk-row" data-open={isOpen ? '1' : undefined} onClick={() => setOpen(isOpen ? null : p.code)}>
                <div className="dk-row__mark" />
                <div className="dk-no">
                  {p.code}
                  <small>项目号</small>
                </div>
                <div className="dk-main">
                  <div className="dk-main__title">{p.title}</div>
                  <div
                    className="dk-perf"
                    style={{ ['--n' as never]: p.episodes.length } as React.CSSProperties}
                    aria-hidden="true"
                  >
                    {p.episodes.map((e) => (
                      <i
                        key={e.n}
                        data-note={e.openNotes > 0 ? '1' : undefined}
                        data-set={e.approved ? '1' : undefined}
                        data-dec={e.n % 10 === 0 ? '1' : undefined}
                      />
                    ))}
                  </div>
                  <div className="dk-meta">
                    全 <b>{p.episodes.length}</b> 集 · 已定 <b>{p.approved}</b> · 版本 v1–v{p.maxVersion} · 评论 <b>{p.comments}</b> ·
                    更新 {relative(p.updatedAt)}
                  </div>
                  {isOpen && (
                    <div className="dk-detail" onClick={(e) => e.stopPropagation()}>
                      {(flagged.length ? flagged : p.episodes.slice(0, 24)).map((e) => (
                        <span key={e.n} className="dk-cell" data-note={e.openNotes ? '1' : undefined} data-set={e.approved ? '1' : undefined}>
                          EP {String(e.n).padStart(3, '0')}
                          {'·'} v{e.version}
                          {e.openNotes ? `· ●${e.openNotes}` : ''}
                        </span>
                      ))}
                      {!flagged.length && <span className="dk-detail__none">全片无未处理批注，上列为已交付集次</span>}
                    </div>
                  )}
                </div>
                <div className="dk-side">
                  <div className="dk-side__n" data-zero={p.openNotes === 0 ? '1' : undefined}>
                    {p.openNotes}
                  </div>
                  <div className="dk-side__l">未处理批注</div>
                  {stamp && <span className="dk-stamp" data-tone={stamp.tone}>{stamp.text}</span>}
                </div>
              </div>
            )
          })}

          {!rows.length && <div className="dk-detail__none" style={{ padding: '34px 0' }}>没有匹配的记录 · 换个检索词或筛选</div>}

          <div className="dk-foot">— 台账到此 · 共 {rows.length} 单 —</div>
        </div>
        <div className="dk-rail" aria-hidden="true" />
      </div>
    </div>
  )
}
