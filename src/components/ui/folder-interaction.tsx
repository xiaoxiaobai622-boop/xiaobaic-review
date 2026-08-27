'use client'

type FolderInteractionProps = {
  coverUrls?: string[]
  itemCount?: number
  className?: string
}

/** Static folder thumbnail. Its size always comes from the video-card wrapper. */
export default function FolderInteraction({ coverUrls = [], itemCount = 0, className = '' }: FolderInteractionProps) {
  const [primaryCover, secondaryCover] = coverUrls
  const displayedCovers = (primaryCover ? 1 : 0) + (secondaryCover ? 1 : 0)
  const remainingCount = Math.max(itemCount - displayedCovers, 0)

  return (
    <div
      className={`relative h-full w-full overflow-hidden bg-muted ${className}`}
      aria-hidden="true"
    >
      <div className="absolute inset-x-0 bottom-0 top-[8%] px-[3.5%] pb-[3%] pt-[5%]">
        <div className="flex h-full w-full gap-[3.5%] overflow-hidden">
          <div className={`flex min-w-0 flex-1 items-center justify-center overflow-hidden rounded-[3px] ${primaryCover ? 'bg-[#242426]' : 'bg-border'}`}>
            {primaryCover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={primaryCover} alt="" className="h-full w-full object-contain" draggable={false} />
            ) : null}
          </div>
          <div className="flex w-[40%] min-w-0 flex-col gap-[6%]">
            <div className={`flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[3px] ${secondaryCover ? 'bg-[#242426]' : 'bg-border'}`}>
              {secondaryCover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={secondaryCover} alt="" className="h-full w-full object-cover" draggable={false} />
              ) : null}
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-[3px] bg-border text-[12px] font-medium text-muted-foreground">
              {remainingCount > 0 ? `+ ${remainingCount}` : ''}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
