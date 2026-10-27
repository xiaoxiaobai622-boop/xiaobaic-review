import { cn } from '@/lib/utils'

export function StudioPageSkeleton({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn('space-y-5', className)} aria-busy="true">
      <span className="sr-only" role="status" aria-live="polite">{label}</span>

      <div className="flex items-center justify-between gap-3">
        <div className="space-y-2">
          <div className="skeleton h-7 w-48 rounded-md" />
          <div className="skeleton h-3.5 w-64 rounded" />
        </div>
        <div className="skeleton h-9 w-28 rounded-lg" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="skeleton h-24 rounded-xl" />
        ))}
      </div>

      <div className="skeleton h-64 rounded-xl" />
    </div>
  )
}
