export type CommentCategory = 'PICTURE' | 'AUDIO' | 'SUBTITLE' | 'EDITING' | 'OTHER'

export const COMMENT_CATEGORIES: Array<{
  value: CommentCategory
  label: string
  dotClass: string
  chipClass: string
  selectedControlClass: string
}> = [
  {
    value: 'PICTURE',
    label: '画面',
    dotClass: 'bg-sky-500',
    chipClass: 'border-sky-500 bg-sky-500 text-white shadow-sm shadow-sky-500/25',
    selectedControlClass: 'border-sky-400/70 bg-sky-500/10 text-sky-700 dark:border-sky-500/50 dark:bg-sky-400/10 dark:text-sky-300',
  },
  {
    value: 'AUDIO',
    label: '声音',
    dotClass: 'bg-amber-500',
    chipClass: 'border-amber-500 bg-amber-500 text-white shadow-sm shadow-amber-500/25',
    selectedControlClass: 'border-amber-400/70 bg-amber-500/10 text-amber-800 dark:border-amber-500/50 dark:bg-amber-400/10 dark:text-amber-300',
  },
  {
    value: 'SUBTITLE',
    label: '字幕',
    dotClass: 'bg-violet-500',
    chipClass: 'border-violet-500 bg-violet-500 text-white shadow-sm shadow-violet-500/25',
    selectedControlClass: 'border-violet-400/70 bg-violet-500/10 text-violet-700 dark:border-violet-500/50 dark:bg-violet-400/10 dark:text-violet-300',
  },
  {
    value: 'EDITING',
    label: '剪辑',
    dotClass: 'bg-emerald-500',
    chipClass: 'border-emerald-500 bg-emerald-500 text-white shadow-sm shadow-emerald-500/25',
    selectedControlClass: 'border-emerald-400/70 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/50 dark:bg-emerald-400/10 dark:text-emerald-300',
  },
  {
    value: 'OTHER',
    label: '其他',
    dotClass: 'bg-slate-500',
    chipClass: 'border-slate-500 bg-slate-500 text-white shadow-sm shadow-slate-500/25',
    selectedControlClass: 'border-slate-400/70 bg-slate-500/10 text-slate-700 dark:border-slate-500/50 dark:bg-slate-400/10 dark:text-slate-300',
  },
]

export function getCommentCategory(value: string | null | undefined) {
  if (!value) return null
  return COMMENT_CATEGORIES.find((item) => item.value === value) || null
}
