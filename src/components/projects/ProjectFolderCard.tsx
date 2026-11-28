'use client'

import type { DragEvent, MouseEvent, RefObject } from 'react'
import { useTranslations } from 'next-intl'
import styles from './ProjectFolderCard.module.css'

const FOLDER_PATH = 'M 0,16 L 0,8 C 0,4 4,0 8,0 L 53.33333333333333,0 c 16,0 16,8 32,8 H 213.65625 a 8,8 0 0 1 8,8 V 200.65625 a 8,8 0 0 1 -8,8 H 8 a 8,8 0 0 1 -8,-8 Z'

interface ProjectFolderCardProps {
  folder: { id: string; name: string }
  coverUrls: string[]
  count: number
  showInfo?: boolean
  titleLines?: 1 | 2
  selected?: boolean
  onToggleSelected?: () => void
  maxWidth?: string
  menuOpen: boolean
  menuButtonRef: RefObject<HTMLButtonElement | null>
  dropTarget: boolean
  onOpen: () => void
  onMenuClick: (event: MouseEvent<HTMLButtonElement>) => void
  onDragEnter: (event: DragEvent<HTMLDivElement>) => void
  onDragOver: (event: DragEvent<HTMLDivElement>) => void
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void
  onDrop: (event: DragEvent<HTMLDivElement>) => void
}

export default function ProjectFolderCard({
  folder, coverUrls, count, showInfo = true, titleLines = 1, selected = false, onToggleSelected, maxWidth, menuOpen, menuButtonRef, dropTarget,
  onOpen, onMenuClick, onDragEnter, onDragOver, onDragLeave, onDrop,
}: ProjectFolderCardProps) {
  const t = useTranslations('projects')
  const covers: Array<string | null> = coverUrls.length > 0 ? coverUrls.slice(0, 3) : [null]

  return (
    <div
      data-project-folder={folder.id}
      data-drop-target={dropTarget ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      className={styles.card}
      style={{ maxWidth }}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {onToggleSelected && (
        <button
          type="button"
          className={`${styles.checkbox} ${selected ? styles.checkboxSelected : ''}`}
          aria-label="选择文件夹"
          aria-pressed={selected}
          onClick={(event) => {
            event.stopPropagation()
            onToggleSelected()
          }}
        >
          {selected && (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="m4.5 8.2 2.2 2.2 4.8-4.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      )}
      <div
        role="button"
        tabIndex={0}
        className={styles.face}
        aria-label={folder.name}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          onOpen()
        }}
      >
        <svg className={styles.svg} viewBox="0 0 221.65625 208.65625" preserveAspectRatio="none" aria-hidden="true">
          <path d={FOLDER_PATH} />
        </svg>
        <div className={styles.body} aria-hidden="true" />
        <div className={styles.contents}>
          <div className={styles.thumbs} data-count={covers.length} aria-hidden="true">
            {covers.map((url, index) => (
              <div key={url ?? `empty-${index}`} className={styles.thumb}>
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- same as the folder thumbnails: fixed card crop, already-optimized thumbnails.
                  <img src={url} alt="" draggable={false} loading="lazy" />
                ) : null}
              </div>
            ))}
          </div>
          {showInfo && (
            <div className={`${styles.footer} ${titleLines === 2 ? styles.footerTall : ''}`}>
              <div className={styles.nameRow}>
                <span className={`${styles.name} ${titleLines === 2 ? styles.nameClamp2 : ''}`} title={folder.name}>{folder.name}</span>
              </div>
              <div className={styles.metaRow}>
                <span className={styles.count}>{t('folderItemCount', { count })}</span>
              </div>
            </div>
          )}
        </div>
      </div>
      {showInfo && (
        <button
          ref={menuButtonRef}
          type="button"
          className={styles.more}
          aria-label={t('folderActions')}
          title={t('folderActions')}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={onMenuClick}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" focusable="false" aria-hidden="true">
            <path fillRule="evenodd" clipRule="evenodd" d="M13 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM9.5 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm-5 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" fill="currentColor" />
          </svg>
        </button>
      )}
    </div>
  )
}