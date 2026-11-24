import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import WhatsNewCategoryList from '@/components/announcements/WhatsNewCategoryList'
import {
  ANNOUNCEMENT_CATEGORIES,
  ANNOUNCEMENT_CATEGORY_LABELS,
  isAnnouncementCategorySlug,
} from '@/lib/announcements/categories'
import { BRAND } from '@/lib/marketing/brand'

type Props = { params: Promise<{ slug: string }> }

export const dynamicParams = false

export function generateStaticParams() {
  return ANNOUNCEMENT_CATEGORIES.map((category) => ({ slug: category.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  if (!isAnnouncementCategorySlug(slug)) return { title: '分类不存在' }
  return { title: { absolute: `${BRAND.zh} · 新增功能 · ${ANNOUNCEMENT_CATEGORY_LABELS[slug]}` } }
}

export default async function WhatsNewCategoryPage({ params }: Props) {
  const { slug } = await params
  if (!isAnnouncementCategorySlug(slug)) notFound()

  const label = ANNOUNCEMENT_CATEGORY_LABELS[slug]

  return (
    <div className="wrap bg-white pb-10 dark:bg-background lg:pb-12">
      <div className="wrap-inner mx-auto w-full max-w-[1200px] px-5 pt-8 sm:px-[25px] sm:pt-12">
        <nav aria-label="面包屑" className="flex flex-wrap items-center gap-x-2 text-[14px] leading-[21px] text-muted-foreground">
          <span>新增功能</span>
          <span aria-hidden="true" className="text-muted-foreground/40">/</span>
          <span className="text-foreground">{label}</span>
        </nav>

        <h1 className="mt-5 break-words text-[44px] font-bold leading-[1.14] tracking-[-0.02em] text-foreground sm:text-[48px] lg:text-[56px]">
          {label}
        </h1>
        <p className="mt-3 text-[14px] leading-[21px] text-muted-foreground">
          该分类下当前可见的新增功能文章
        </p>

        <WhatsNewCategoryList slug={slug} />
      </div>
    </div>
  )
}