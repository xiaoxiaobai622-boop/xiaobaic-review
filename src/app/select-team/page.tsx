import { Suspense } from 'react'
import SelectTeamClient from './SelectTeamClient'

export default function SelectTeamPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-background">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
        </div>
      }
    >
      <SelectTeamClient />
    </Suspense>
  )
}
