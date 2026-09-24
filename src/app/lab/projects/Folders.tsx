'use client'

import { useMemo, useState } from 'react'
import {
  GROUP_NAMES,
  LAB_GROUPS,
  LAB_PROJECTS,
  LAB_TOTALS,
  UNFILED,
  relative,
  summarize,
  type LabGroup,
  type LabProject,
} from './fixture'

const SORTS = [
  { id: 'open', label: '未处理↓' },
  { id: 'recent', label: '最近更新' },
  { id: 'eps', label: '集数↓' },
  { id: 'code', label: '编号' },
] as const
type Sort = (typeof SORTS)[number]['id']

const SORTERS: Record<Sort, (a: LabProject, b: LabProject) => number> = {
  open: (a, b) => b.openNotes - a.openNotes,
  recent: (a, b) => b.updatedAt - a.updatedAt,
  eps: (a, b) => b.episodes.length - a.episodes.length,
  code: (a, b) => a.code.localeCompare(b.code),
}

/** The three folios that ride on top of a drawer: most recently worked first. */
function coversOf(list: LabProject[]) {
  return list.slice().sort(SORTERS.recent).slice(0, 3)
}

function coverOf(p: LabProject) {
  return p.episodes[p.episodes.length - 1].thumb
}

export default function Folders() {
  const [groups, setGroups] = useState<LabGroup[]>(LAB_GROUPS)
  const [filed, setFiled] = useState<Record<string, string>>(() =>
    Object.fromEntries(LAB_PROJECTS.map((p) => [p.code, p.groupId])),
  )
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('open')
  const [open, setOpen] = useState<string | null>(LAB_GROUPS[0].id)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [menu, setMenu] = useState<string | null>(null)

  const needle = q.trim().toLowerCase()

  const matched = useMemo(
    () => (needle ? LAB_PROJECTS.filter((p) => `${p.code} ${p.title}`.toLowerCase().includes(needle)) : LAB_PROJECTS),
    [needle],
  )

  const bags: LabGroup[] = useMemo(
    () => [...groups, { id: UNFILED, name: GROUP_NAMES[UNFILED], tone: 'work' }],
    [groups],
  )

  const buckets = useMemo(() => {
    const map = new Map<string, LabProject[]>()
    for (const b of bags) map.set(b.id, [])
    for (const p of matched) {
      const gid = filed[p.code]
      const list = map.get(gid) ?? map.get(UNFILED)
      list?.push(p)
    }
    return map
  }, [bags, filed, matched])

  function file(code: string, gid: string) {
    setFiled((m) => ({ ...m, [code]: gid }))
    setMenu(null)
    setDrag(null)
    setOver(null)
  }

  function commitNew() {
    const name = draft.trim()
    setCreating(false)
    if (!name) return
    const id = `g-${Date.now()}`
    setGroups((gs) => [...gs, { id, name, tone: 'work' }])
    setDraft('')
    setOpen(id)
  }

  function commitRename() {
    const name = draft.trim()
    if (name && renaming) setGroups((gs) => gs.map((g) => (g.id === renaming ? { ...g, name } : g)))
    setRenaming(null)
    setDraft('')
  }

  function removeGroup(bag: LabGroup) {
    setGroups((gs) => gs.filter((g) => g.id !== bag.id))
    if (open === bag.id) setOpen(null)
  }

  function ticket(p: LabProject, k: number, gid: string) {
    const targets = bags.filter((b) => b.id !== gid)
    return (
      <div
        key={p.code}
        className="fd-ticket"
        style={{ ['--k' as never]: k } as React.CSSProperties}
        draggable
        data-drag={drag === p.code ? '1' : undefined}
        onDragStart={() => setDrag(p.code)}
        onDragEnd={() => {
          setDrag(null)
          setOver(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setMenu(null)
        }}
      >
        <span className="fd-ticket__grip" aria-hidden="true" />
        <img className="fd-ticket__cover" src={`/api/lab/frame/${coverOf(p)}`} alt="" />
        <div className="fd-ticket__txt">
          <span className="fd-ticket__title">{p.title}</span>
          <span className="fd-ticket__meta">
            NO.{p.code} · {p.episodes.length} 集 · v1–v{p.maxVersion} · 评论 {p.comments} · 更新 {relative(p.updatedAt)}
          </span>
        </div>
        <span className="fd-ticket__n" data-zero={p.openNotes ? undefined : '1'}>
          {p.openNotes}
          <small>待办</small>
        </span>
        <button type="button" className="fd-file" aria-expanded={menu === p.code} onClick={() => setMenu(menu === p.code ? null : p.code)}>
          归入…
        </button>
        {menu === p.code && (
          <>
            <span className="fd-scrim" onClick={() => setMenu(null)} />
            <div className="fd-menu" role="menu" aria-label={`把 ${p.title} 归入`}>
              {targets.map((b) => (
                <button key={b.id} type="button" role="menuitem" className="fd-menu__item" onClick={() => file(p.code, b.id)}>
                  {b.name}
                  <small>{(buckets.get(b.id) ?? []).length} 件</small>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    )
  }

  const looseCount = (buckets.get(UNFILED) ?? []).length

  return (
    <div className="fd">
      <header className="fd-head">
        <div className="fd-id">
          <span className="fd-id__cn">片袋</span>
          <span className="fd-id__en">FILM FOLIO · 项目归袋</span>
        </div>
        <div className="fd-ops">
          <input
            className="fd-in"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="编号或片名"
            aria-label="检索项目"
          />
          <span className="fd-ops__k">排序</span>
          {SORTS.map((s) => (
            <button key={s.id} type="button" className="fd-chip" aria-pressed={sort === s.id} onClick={() => setSort(s.id)}>
              {s.label}
            </button>
          ))}
          <button
            type="button"
            className="fd-mk"
            onClick={() => {
              setCreating(true)
              setDraft('')
              setOpen(null)
            }}
          >
            + 新建片袋
          </button>
        </div>
        <div className="fd-where">
          全站 <b>{LAB_TOTALS.projects}</b> 个项目 · <b>{bags.length - 1}</b> 只袋 · 散件 <b data-hot={looseCount ? '1' : undefined}>{looseCount}</b>
          {needle && <> · 检索「{q.trim()}」命中 <b>{matched.length}</b></>}
        </div>
      </header>

      <main className="fd-wall">
        {bags.map((bag, i) => {
          const list = buckets.get(bag.id) ?? []
          const s = summarize(list)
          const isOpen = open === bag.id
          const isLoose = bag.id === UNFILED
          const sorted = list.slice().sort(SORTERS[sort])
          return (
            <article
              key={bag.id}
              className="fd-drawer"
              data-tone={bag.tone}
              data-loose={isLoose ? '1' : undefined}
              data-open={isOpen ? '1' : undefined}
              data-over={over === bag.id ? '1' : undefined}
              onDragOver={(e) => {
                e.preventDefault()
                setOver(bag.id)
              }}
              onDragLeave={() => setOver((v) => (v === bag.id ? null : v))}
              onDrop={(e) => {
                e.preventDefault()
                if (drag) file(drag, bag.id)
              }}
            >
              <div className="fd-face">
                <div className="fd-covers" aria-hidden="true">
                  {coversOf(list).map((p, k) => (
                    <span key={p.code} className="fd-cover" style={{ ['--k' as never]: k } as React.CSSProperties}>
                      <img src={`/api/lab/frame/${coverOf(p)}`} alt="" />
                    </span>
                  ))}
                  {!list.length && <span className="fd-cover fd-cover--void" />}
                </div>

                <div className="fd-plate">
                  <div className="fd-label">
                    {renaming === bag.id ? (
                      <input
                        autoFocus
                        className="fd-label__in"
                        value={draft}
                        aria-label="片袋名称"
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename()
                          if (e.key === 'Escape') {
                            setRenaming(null)
                            setDraft('')
                          }
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="fd-label__name"
                        aria-expanded={isOpen}
                        onClick={() => setOpen(isOpen ? null : bag.id)}
                      >
                        {bag.name}
                      </button>
                    )}
                    <span className="fd-label__no">BAG {String(i + 1).padStart(2, '0')}</span>
                  </div>

                  <div className="fd-facts">
                    <span className="fd-fact">
                      <b>{s.n}</b>
                      <i>件</i>
                    </span>
                    <span className="fd-fact">
                      <b>{s.episodes.toLocaleString('en-US')}</b>
                      <i>集</i>
                    </span>
                    <span className="fd-fact" data-hot={s.openNotes ? '1' : undefined}>
                      <b>{s.openNotes.toLocaleString('en-US')}</b>
                      <i>待办</i>
                    </span>
                    <span className="fd-fact fd-fact--when">{s.latest ? `动过 ${relative(s.latest)}` : '从未动过'}</span>
                  </div>
                </div>

                <div className="fd-tools">
                  {isLoose ? (
                    <span className="fd-seal-note">未归类的项目落在这只袋</span>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="fd-tool"
                        onClick={() => {
                          setRenaming(bag.id)
                          setDraft(bag.name)
                        }}
                      >
                        改名
                      </button>
                      <button
                        type="button"
                        className="fd-tool"
                        onClick={() => removeGroup(bag)}
                        disabled={s.n > 0}
                        title={s.n > 0 ? `袋里还有 ${s.n} 件，先搬空才能删` : '删掉这只袋'}
                      >
                        删袋
                      </button>
                    </>
                  )}
                  <button type="button" className="fd-tool fd-tool--end" onClick={() => setOpen(isOpen ? null : bag.id)}>
                    {isOpen ? '合上' : '打开'}
                  </button>
                </div>
              </div>

              {isOpen && (
                <div className="fd-tray">
                  <div className="fd-tray__cap">
                    <span>
                      {bag.name} · {list.length} 件
                    </span>
                    <span className="fd-tray__hint">拖条目到别的袋 = 归位</span>
                  </div>
                  {sorted.length ? (
                    sorted.map((p, k) => ticket(p, k, bag.id))
                  ) : (
                    <p className="fd-empty">{needle ? '这只袋里没有匹配的片子，换个检索词' : '空袋 · 从别的袋拖进来，或新建后归位'}</p>
                  )}
                </div>
              )}
            </article>
          )
        })}

        {creating && (
          <article className="fd-drawer fd-drawer--new">
            <div className="fd-face">
              <div className="fd-covers" aria-hidden="true">
                <span className="fd-cover fd-cover--void" />
              </div>
              <div className="fd-label">
                <input
                  autoFocus
                  className="fd-label__in"
                  value={draft}
                  placeholder="袋名，例如「快手定制」"
                  aria-label="新片袋名称"
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitNew}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitNew()
                    if (e.key === 'Escape') {
                      setCreating(false)
                      setDraft('')
                    }
                  }}
                />
                <span className="fd-label__no">NEW BAG</span>
              </div>
              <div className="fd-facts">
                <span className="fd-fact fd-fact--when">空袋 · 回车确认，Esc 取消</span>
              </div>
            </div>
          </article>
        )}
      </main>

      <footer className="fd-foot">
        — 共 {bags.length} 只袋（含散件）· {LAB_TOTALS.projects} 个项目 —
        <small>试做页：新建 / 改名 / 删袋 / 归位只活在本页，刷新即回到样本初始态</small>
      </footer>
    </div>
  )
}
