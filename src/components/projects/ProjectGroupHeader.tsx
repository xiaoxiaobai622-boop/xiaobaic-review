'use client'

import styles from './ProjectGroupHeader.module.css'

interface ProjectGroupHeaderProps {
  countLabel: string
  sizeLabel?: string
  collapsed: boolean
  onToggleCollapsed: () => void
  checked: boolean
  indeterminate?: boolean
  onToggleChecked: () => void
  selectAllLabel: string
  collapseLabel: string
}

export default function ProjectGroupHeader({
  countLabel,
  sizeLabel,
  collapsed,
  onToggleCollapsed,
  checked,
  indeterminate = false,
  onToggleChecked,
  selectAllLabel,
  collapseLabel,
}: ProjectGroupHeaderProps) {
  const meta = sizeLabel ? `${countLabel} • ${sizeLabel}` : countLabel
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <button
          type="button"
          role="checkbox"
          aria-checked={indeterminate ? 'mixed' : checked}
          aria-label={selectAllLabel}
          className={styles.checkbox}
          data-checked={checked || indeterminate || undefined}
          onClick={onToggleChecked}
        >
          {checked || indeterminate ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              {indeterminate ? (
                <path d="M4 8h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              ) : (
                <path d="m4.5 8.2 2.2 2.2 4.8-4.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              )}
            </svg>
          ) : null}
        </button>
        <button
          type="button"
          className={styles.collapse}
          aria-label={collapseLabel}
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className={collapsed ? styles.chevronCollapsed : styles.chevron}
          >
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M6.237 11.801a.75.75 0 0 1-.042-1.06L8.725 8l-2.53-2.741a.75.75 0 0 1 1.102-1.017l3 3.25a.75.75 0 0 1 0 1.017l-3 3.25a.75.75 0 0 1-1.06.043Z"
              fill="currentColor"
            />
          </svg>
        </button>
        <span className={styles.text}>{meta}</span>
      </div>
    </header>
  )
}