'use client'

import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { FileQuestion, Home } from 'lucide-react'
import BrandLogo from '@/components/BrandLogo'
import ThemeToggle from '@/components/ThemeToggle'
import LanguageToggle from '@/components/LanguageToggle'
import { useTranslations } from 'next-intl'

export default function ShareNotFound() {
  const t = useTranslations('share')
  const tc = useTranslations('common')
  const tn = useTranslations('notFound')

  return (
    <div className="flex-1 min-h-0 bg-background flex items-center justify-center p-4">
      {/* Language and theme toggles */}
      <div className="fixed top-3 right-3 z-20 flex items-center gap-2">
        <LanguageToggle />
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md text-center">
        <BrandLogo height={64} className="mx-auto mb-4" />
        <h1 className="text-3xl font-bold text-foreground mb-2">{tc('viTransfer')}</h1>

        <Card className="mt-6">
          <CardHeader className="text-center">
            <div className="mx-auto mb-2">
              <FileQuestion className="w-12 h-12 text-muted-foreground" />
            </div>
            <CardTitle>{t('linkNotFound')}</CardTitle>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm text-muted-foreground">
              {t('linkInvalid')}
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              {t('contactSharer')}
            </p>
            {/* 10-17 真人点击实测：这页原来一个链接都没有（`a[href]` 数量 0），
                客户点开一条过期短链后只能按浏览器后退。给一条回站内的出口。 */}
            <Button asChild className="mt-5 w-full">
              <Link href="/">
                <Home className="mr-2 h-4 w-4" />
                {tn('goHome')}
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
