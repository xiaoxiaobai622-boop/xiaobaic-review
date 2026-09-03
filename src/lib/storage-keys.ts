/**
 * Build a storage key that is directly attributable to a team.
 * IDs are supplied by the server after authorization; callers must not use
 * client-provided team or project values for access control.
 */
export function teamProjectStorageKey(
  teamId: string,
  projectId: string,
  ...parts: string[]
): string {
  const clean = (value: string) => value.replace(/^\/+|\/+$/g, '')
  return ['teams', clean(teamId), 'projects', clean(projectId), ...parts.map(clean)]
    .filter(Boolean)
    .join('/')
}
