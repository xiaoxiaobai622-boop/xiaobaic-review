'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import BrandLogo from '@/components/BrandLogo'
import { AnimatedCharacters } from '@/components/ui/animated-characters'

export const BRAND_NAME = '逐帧审阅'

type CharacterState = {
  isTyping?: boolean
  showPassword?: boolean
  passwordLength?: number
}

type AuthSplitLayoutProps = {
  characters?: CharacterState
  headerEnd?: ReactNode
  children: ReactNode
}

export function AuthSplitLayout({ characters, headerEnd, children }: AuthSplitLayoutProps) {
  const t = useTranslations('auth')

  return (
    <div className="flex min-h-dvh flex-1 bg-popover">
      {/* Frame.io auth portal: left column is flex 0 1 33%, capped at 640px */}
      <aside className="relative hidden overflow-hidden bg-[#15122a] text-white lg:flex lg:w-[33%] lg:max-w-[640px] lg:shrink lg:grow-0 lg:flex-col [background-image:linear-gradient(165deg,#221b45_0%,#15122a_52%,#0e0c1c_100%)]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 [background-image:radial-gradient(rgba(255,255,255,0.09)_1px,transparent_1px)] [background-size:24px_24px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_78%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-[46%] h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#6C3FF5]/45 blur-[110px]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -right-24 h-[360px] w-[360px] rounded-full bg-[#FF9B6B]/25 blur-[100px]"
        />

        <div className="relative z-10 flex items-center gap-3 px-8 pt-8">
          <BrandLogo height={28} ariaHidden />
          <span className="text-[15px] font-semibold tracking-tight">{BRAND_NAME}</span>
        </div>

        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-8">
          {/* The figures fill ~450 of the 550px canvas; nudge so the group itself is centered */}
          <div className="relative h-[220px] w-[302px] translate-x-[calc(50px*var(--s))] xl:h-[240px] xl:w-[330px] 2xl:h-[288px] 2xl:w-[396px] min-[1800px]:h-[340px] min-[1800px]:w-[468px] [--s:0.55] xl:[--s:0.6] 2xl:[--s:0.72] min-[1800px]:[--s:0.85]">
            <div
              aria-hidden
              className="pointer-events-none absolute -bottom-4 left-[calc(50%-50px*var(--s))] h-10 w-[100%] -translate-x-1/2 rounded-[100%] bg-black/50 blur-xl"
            />
            <div className="origin-top-left [transform:scale(var(--s))] [filter:drop-shadow(0_0_1px_rgba(255,255,255,0.45))]">
              <AnimatedCharacters
                isTyping={characters?.isTyping ?? false}
                showPassword={characters?.showPassword ?? false}
                passwordLength={characters?.passwordLength ?? 0}
              />
            </div>
          </div>
          <div aria-hidden className="mt-0 h-px w-full bg-white/10" />
        </div>

        <div className="relative z-10 px-8 pb-8">
          <p className="max-w-[26ch] text-[15px] font-medium leading-6 text-white/90">{t('brandTagline')}</p>
          <div
            aria-hidden
            className="mt-6 h-3 w-full [background-image:linear-gradient(to_right,rgba(255,255,255,0.4)_1px,transparent_1px),linear-gradient(to_right,rgba(255,255,255,0.18)_1px,transparent_1px)] [background-position:0_0,0_6px] [background-repeat:repeat-x] [background-size:48px_12px,8px_6px]"
          />
          <p className="mt-2 text-[10px] tabular-nums tracking-[0.12em] text-white/50">00:00:00:00</p>
        </div>
      </aside>

      <section className="relative flex min-h-dvh min-w-0 flex-1 flex-col lg:min-h-0">
        <header className="flex h-16 shrink-0 items-center justify-between px-5 sm:px-10 lg:px-14">
          <div className="flex items-center gap-2.5 lg:hidden">
            <BrandLogo height={24} ariaHidden />
            <span className="text-sm font-semibold tracking-tight text-foreground">{BRAND_NAME}</span>
          </div>
          <span className="hidden lg:block" />
          {headerEnd}
        </header>

        <div className="flex flex-1 items-center justify-center px-5 pb-10 pt-4 sm:px-10 lg:px-14">
          {children}
        </div>

        <footer className="flex h-12 shrink-0 items-center justify-center px-5 text-[11px] tabular-nums text-muted-foreground sm:px-10 lg:justify-end lg:px-14">
          © {new Date().getFullYear()} {BRAND_NAME}
        </footer>
      </section>
    </div>
  )
}
