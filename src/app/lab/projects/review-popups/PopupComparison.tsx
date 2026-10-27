'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { LabTimeFormatProvider } from './useLabTimeFormat'
import { applyThemeChoice, readStoredTheme, resolveDefaultTheme } from '@/lib/theme'
import { Check, Keyboard, Repeat, Volume2 } from 'lucide-react'
import BaselineCommentInput from './baseline/CommentInput'
import CandidateCommentInput from './candidate/CommentInput'
import BaselineTimeFormat from './baseline/TimeFormatSwitch'
import CandidateTimeFormat from './candidate/TimeFormatSwitch'
import BaselineOverflow from './baseline/ReviewOverflowMenu'
import CandidateOverflow from './candidate/ReviewOverflowMenu'
import styles from './comparison.module.css'

type SampleState = 'normal' | 'empty' | 'long' | 'loading' | 'disabled'

export default function PopupComparison() {
  const params = useSearchParams()
  const pane = params?.get('pane')
  const [theme, setTheme] = useState('dark')
  const [sample, setSample] = useState<SampleState>('normal')
  const [inline, setInline] = useState(true)

  const previewTheme = pane ? params?.get('theme') ?? 'dark' : theme
  useEffect(() => {
    const root = document.documentElement
    const applyPreview = () => {
      if (root.hasAttribute('data-theme')) root.removeAttribute('data-theme')
      if (root.classList.contains('dark') !== (previewTheme === 'dark')) root.classList.toggle('dark', previewTheme === 'dark')
    }
    applyPreview()
    // App-wide settings can resolve after this isolated preview has mounted.
    const observer = new MutationObserver(applyPreview)
    observer.observe(root, { attributes: true, attributeFilter: ['class', 'data-theme'] })
    return () => {
      observer.disconnect()
      applyThemeChoice(readStoredTheme() ?? resolveDefaultTheme(localStorage.getItem('adminDefaultTheme')))
    }
  }, [previewTheme])

  if (pane === 'baseline' || pane === 'candidate') {
    return <LabTimeFormatProvider><PopupSample candidate={pane === 'candidate'} sample={(params?.get('sample') ?? 'normal') as SampleState} inline={params?.get('inline') !== 'false'} /></LabTimeFormatProvider>
  }

  return (
    <main className={styles.comparison}>
      <header className={styles.header}>
        <div><h1>浮层手感对照</h1><p>左侧保留当前交互，右侧为候选；选择和批注仅在样本内生效。</p></div>
        <div className={styles.options}>
          <label>主题<select aria-label="预览主题" value={theme} onChange={event => setTheme(event.target.value)}><option value="dark">深色</option><option value="light">浅色</option></select></label>
          <label>样本<select aria-label="样本状态" value={sample} onChange={event => setSample(event.target.value as SampleState)}><option value="normal">正常</option><option value="empty">空批注</option><option value="long">超长内容</option><option value="loading">发送中</option><option value="disabled">已锁定</option></select></label>
          <label className={styles.checkbox}><input type="checkbox" checked={inline} onChange={event => setInline(event.target.checked)} />框内工具栏</label>
        </div>
      </header>
      <div className={styles.panes}>
        {(['baseline', 'candidate'] as const).map(version => {
          const url = `/lab/projects?v=popups&pane=${version}&theme=${theme}&sample=${sample}&inline=${inline}`
          return (
            <section key={version} className={styles.pane}>
              <div className={styles.paneHeading}><h2>{version === 'baseline' ? '当前版本' : '候选版本'}</h2><a href={url} target="_blank" rel="noreferrer">单独试用</a></div>
              <LabTimeFormatProvider key={`${version}-${sample}-${inline}`}>
                <PopupSample candidate={version === 'candidate'} sample={sample} inline={inline} />
              </LabTimeFormatProvider>
            </section>
          )
        })}
      </div>
      <p className={styles.hint}>试试连续点同一按钮、从表情切到可见范围、按 Esc 关闭；右侧浮层从按钮处展开，再自然收回。</p>
    </main>
  )
}

function PopupSample({ candidate, sample, inline }: { candidate: boolean; sample: SampleState; inline: boolean }) {
  const [text, setText] = useState(sample === 'empty' ? '' : sample === 'long' ? '这里的色温再冷一点，保留高光层次。'.repeat(30) : '这里的色温再冷一点，保留高光层次。')
  const [visibility, setVisibility] = useState<'PUBLIC' | 'INTERNAL'>('PUBLIC')
  const [loop, setLoop] = useState(false)
  const [notice, setNotice] = useState('')
  const [comments, setComments] = useState<string[]>([])
  const Composer = candidate ? CandidateCommentInput : BaselineCommentInput
  const TimeFormat = candidate ? CandidateTimeFormat : BaselineTimeFormat
  const Overflow = candidate ? CandidateOverflow : BaselineOverflow
  const title = sample === 'long' ? '城市之间_品牌年度形象片_导演剪辑_调色审核_最终交付前确认版本_超长文件名.mp4' : '城市之间 · 调色审阅.mp4'

  return (
    <div className={styles.sample} data-popup-sample={candidate ? 'candidate' : 'baseline'}>
      <header className={styles.reviewHeader}>
        <div><h1 title={title}>{title}</h1><span>v3 · 本地样本</span></div>
        <Overflow>
          <button className={styles.setting} type="button" aria-pressed={loop} onClick={() => setLoop(value => !value)}><Repeat size={15} /><span>循环播放</span>{loop && <Check size={15} />}</button>
          <div className={styles.divider} />
          <label className={styles.setting}><Volume2 size={15} /><span>音量</span><input aria-label="样本音量" type="range" min="0" max="100" defaultValue="70" /></label>
          <button className={styles.setting} type="button" onClick={() => setNotice('样本快捷键：Tab 切换控件，方向键选择，Esc 关闭浮层。')}><Keyboard size={15} /><span>快捷键</span></button>
        </Overflow>
      </header>
      <div className={styles.viewer}>静态预览 · 本页不播放媒体</div>
      <div className={styles.timeline}><span /></div>
      <div className={styles.transport}><TimeFormat currentTime={12.32} duration={93.312} fps={25} /><span>25 fps</span></div>
      <section className={styles.comments} aria-label="样本批注">
        <div className={styles.commentsHeading}><h2>批注</h2><span>{(sample === 'empty' ? 0 : 2) + comments.length}</span></div>
        {sample !== 'empty' && <><article><span className={styles.avatar}>林</span><div><p><b>林</b><time>12:32</time></p><p>高光可以再收一点，人物肤色保持现在的方向。</p></div></article><article><span className={styles.avatar}>陈</span><div><p><b>陈</b><time>13:08</time></p><p>这个镜头的衔接很顺。</p></div></article></>}
        {comments.map((comment, index) => <article key={index}><span className={styles.avatar}>我</span><div><p><b>我</b><span>仅本页</span></p><p>{comment}</p></div></article>)}
      </section>
      <Composer newComment={text} onCommentChange={setText} onSubmit={() => { if (text.trim()) { setComments(value => [...value, text]); setText(''); setNotice('已加入本页样本，没有发送到项目。') } }}
        loading={sample === 'loading'} selectedTimestamp={12.32} selectedVideoFps={25} selectedVideoDurationSeconds={93.312}
        replyingToComment={null} onCancelReply={() => {}} currentVideoRestricted={false} commentsDisabled={sample === 'disabled'}
        showCategoryPicker={false} visibility={visibility} onVisibilityChange={setVisibility} sendInsideComposer={inline}
        onStartDrawing={() => setNotice('此处只试用浮层，画面标注未连接。')} />
      <p className={styles.notice} role="status">{notice || '样本操作不会改变真实项目或审片偏好。'}</p>
    </div>
  )
}
