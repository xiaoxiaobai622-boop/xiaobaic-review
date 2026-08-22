const ACTIVE_TEAM_KEY = 'vitransfer_active_team_id'

export function getActiveTeamId(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(ACTIVE_TEAM_KEY)
}

export function setActiveTeamId(teamId: string | null) {
  if (typeof window === 'undefined') return
  if (teamId) window.localStorage.setItem(ACTIVE_TEAM_KEY, teamId)
  else window.localStorage.removeItem(ACTIVE_TEAM_KEY)
}
