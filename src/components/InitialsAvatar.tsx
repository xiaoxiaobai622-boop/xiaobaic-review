'use client'

import { useEffect, useState } from 'react'
import { AVATAR_HEX, cn, getUserColor } from '@/lib/utils'

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

export function initialsFromName(name: string | null | undefined): string {
  const value = (name || '').trim()
  if (!value) return '?'

  return Array.from(value)[0].toUpperCase()
}

function sizeClasses(size: AvatarSize) {
  switch (size) {
    case 'xs':
      return 'h-5 w-5 text-[8px] sm:text-[9px]'
    case 'sm':
      return 'h-7 w-7 text-[11px]'
    case 'lg':
      return 'h-10 w-10 text-sm'
    case 'xl':
      return 'h-24 w-24 text-3xl'
    case 'md':
    default:
      return 'h-8 w-8 text-xs'
  }
}

export function InitialsAvatar(props: {
  name?: string | null
  src?: string | null
  size?: AvatarSize
  className?: string
  title?: string
  isInternal?: boolean // True if this is an internal/studio user (sender), false for client (receiver)
}) {
  const { name, src, size = 'md', className, title, isInternal = false } = props

  const color = getUserColor(name, isInternal)
  const background = AVATAR_HEX[color.border] || '#4f46e5'
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    setImageFailed(false)
  }, [src])

  return (
    <div
      title={title || (name || undefined)}
      className={cn(
        'flex items-center justify-center rounded-full font-semibold select-none',
        'overflow-hidden text-white',
        sizeClasses(size),
        className
      )}
      style={{ backgroundColor: background }}
    >
      {src && !imageFailed ? (
        <img
          src={src}
          alt={name || '头像'}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setImageFailed(true)}
        />
      ) : (
        initialsFromName(name)
      )}
    </div>
  )
}
