'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Docket from './Docket'
import Folders from './Folders'
import ScreeningRoom from './ScreeningRoom'
import Timeline from './Timeline'
import './lab.css'

const VARIANTS = [
  { id: 'timeline', name: 'A · 时间线', host: Timeline },
  { id: 'docket', name: 'B · 交付台账', host: Docket },
  { id: 'house', name: 'C · 放映厅', host: ScreeningRoom },
  { id: 'folders', name: 'D · 片袋', host: Folders },
]

function Lab() {
  const params = useSearchParams()
  const fromUrl = params?.get('v')
  const [v, setV] = useState(() => VARIANTS.find((x) => x.id === fromUrl)?.id ?? 'timeline')
  const active = VARIANTS.find((x) => x.id === v) ?? VARIANTS[0]
  const Host = active.host

  return (
    <div className="lab-root">
      <div className="lab-chrome">
        <span className="lab-chrome__word">/studio/projects 重做 · 四套真页面</span>
        {VARIANTS.map((x) => (
          <button key={x.id} type="button" className="lab-chrome__tab" aria-current={x.id === v} onClick={() => setV(x.id)}>
            {x.name}
          </button>
        ))}
        <span className="lab-chrome__note">
          <span className="lab-chrome__dot" />
          样本数据 · 本地试做页 · 未接生产，可随时整目录删除
        </span>
      </div>
      <Host />
    </div>
  )
}

export default function LabProjectsPage() {
  return (
    <Suspense fallback={null}>
      <Lab />
    </Suspense>
  )
}
