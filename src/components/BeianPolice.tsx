import { cn } from '@/lib/utils'

export default function BeianPolice({ className }: { className?: string }) {
  return (
    <a
      href="https://beian.mps.gov.cn/#/query/webSearch?code=45010002451490"
      rel="noreferrer"
      target="_blank"
      className={cn('inline-flex items-center gap-1.5', className)}
    >
      <img src="/beian/police.png" alt="公安备案" width={20} height={22} className="h-[18px] w-auto shrink-0" />
      <span>桂公网安备45010002451490号</span>
    </a>
  )
}
