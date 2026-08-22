import ShareLocaleProvider from '@/components/ShareLocaleProvider'

export default function TeamShareLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <ShareLocaleProvider>{children}</ShareLocaleProvider>
}
