import ShareLocaleProvider from '@/components/ShareLocaleProvider'

export default function RootShareLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <ShareLocaleProvider>{children}</ShareLocaleProvider>
}
