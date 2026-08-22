import Link from 'next/link'

type LegalSection = {
  heading: string
  paragraphs: string[]
}

export function LegalDoc({
  title,
  updatedAt,
  intro,
  sections,
}: {
  title: string
  updatedAt: string
  intro: string
  sections: LegalSection[]
}) {
  return (
    <div className="min-h-dvh bg-[#f4f5f7] text-[#171a20]">
      <header className="border-b border-[#dfe2e7] bg-white">
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-5">
          <Link href="/" className="font-semibold text-[15px]">逐帧审阅</Link>
          <Link href="/" className="text-sm text-[#6f7580] hover:text-[#171a20]">返回首页</Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:py-14">
        <p className="text-xs font-semibold text-[#245fe7]">Legal</p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">{title}</h1>
        <p className="mt-3 text-sm text-[#6f7580]">更新日期：{updatedAt}</p>
        <p className="mt-6 text-[15px] leading-7 text-[#3f4550]">{intro}</p>

        <div className="mt-10 space-y-9">
          {sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-lg font-semibold">{section.heading}</h2>
              <div className="mt-3 space-y-3">
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph} className="text-[15px] leading-7 text-[#3f4550]">{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>

      <footer className="border-t border-[#dfe2e7] bg-white">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 py-5 text-xs text-[#8b919b]">
          <span>逐帧审阅</span>
          <a href="https://beian.miit.gov.cn" target="_blank" rel="noopener noreferrer">
            桂ICP备2026017259号-2
          </a>
        </div>
      </footer>
    </div>
  )
}
