import TeamAdminShell from '@/components/TeamAdminShell'

export default function ClientsLayout({ children }: { children: React.ReactNode }) {
  return <TeamAdminShell>{children}</TeamAdminShell>
}
