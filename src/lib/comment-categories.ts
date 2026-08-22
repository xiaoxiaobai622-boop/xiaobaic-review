export type CommentCategory = 'PICTURE' | 'AUDIO' | 'SUBTITLE' | 'EDITING' | 'OTHER'

export const COMMENT_CATEGORIES: Array<{
  value: CommentCategory
  label: string
  dotClass: string
  chipClass: string
}> = [
  {
    value: 'PICTURE',
    label: '画面',
    dotClass: 'bg-sky-500',
    chipClass: 'border-sky-500 bg-sky-500 text-white shadow-sm shadow-sky-500/25',
  },
  {
    value: 'AUDIO',
    label: '声音',
    dotClass: 'bg-amber-500',
    chipClass: 'border-amber-500 bg-amber-500 text-white shadow-sm shadow-amber-500/25',
  },
  {
    value: 'SUBTITLE',
    label: '字幕',
    dotClass: 'bg-violet-500',
    chipClass: 'border-violet-500 bg-violet-500 text-white shadow-sm shadow-violet-500/25',
  },
  {
    value: 'EDITING',
    label: '剪辑',
    dotClass: 'bg-emerald-500',
    chipClass: 'border-emerald-500 bg-emerald-500 text-white shadow-sm shadow-emerald-500/25',
  },
  {
    value: 'OTHER',
    label: '其他',
    dotClass: 'bg-slate-500',
    chipClass: 'border-slate-500 bg-slate-500 text-white shadow-sm shadow-slate-500/25',
  },
]

export function getCommentCategory(value: string | null | undefined) {
  if (!value) return null
  return COMMENT_CATEGORIES.find((item) => item.value === value) || null
}
