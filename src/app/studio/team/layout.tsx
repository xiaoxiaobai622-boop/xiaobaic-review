import TeamAdminShell from '@/components/TeamAdminShell'

export default function TeamManagementLayout({ children }: { children: React.ReactNode }) {
  return <TeamAdminShell>{children}</TeamAdminShell>
}
