import { NextRequest, NextResponse } from 'next/server'
import { getShareAuth } from './auth'
import { resolveShareMetadata, getShareScopeVideoIds, isShareLinkActive } from './share-links'
import { SHARE_ERROR_CODES } from './share-error-codes'
import { logShareDenial, requestEndpoint } from './share-auth'

/**
 * A scoped link is a data boundary for every video route, not only comments.
 * Team members bypass; a presented share bearer must cover the requested
 * video. With no bearer the route's own permission gate still decides.
 */
export async function enforceShareVideoScope(
  request: NextRequest,
  projectId: string,
  videoId: string,
  isTeamMember: boolean,
): Promise<NextResponse | null> {
  if (isTeamMember) return null

  const shareAuth = await getShareAuth(request)
  if (!shareAuth.presented) return null
  if (shareAuth.failure) {
    return NextResponse.json(
      { error: shareAuth.failure.message, code: shareAuth.failure.code },
      { status: 401 },
    )
  }

  const payload = shareAuth.payload
  if (!payload) return null

  const resolved = await resolveShareMetadata(payload.shareId)
  if (!resolved.policy || !resolved.project || resolved.project.id !== projectId) {
    logShareDenial({ shareToken: payload.shareId, endpoint: requestEndpoint(request), reason: SHARE_ERROR_CODES.LINK_MISSING })
    return NextResponse.json(
      { error: 'Access denied', code: SHARE_ERROR_CODES.LINK_MISSING },
      { status: 403 },
    )
  }

  if (!isShareLinkActive(resolved.policy)) {
    return NextResponse.json(
      { error: 'Share link is no longer active', code: SHARE_ERROR_CODES.LINK_INACTIVE },
      { status: 410 },
    )
  }

  const scopedVideoIds = await getShareScopeVideoIds(resolved.policy, projectId)
  if (scopedVideoIds && !scopedVideoIds.has(videoId)) {
    logShareDenial({ shareToken: payload.shareId, endpoint: requestEndpoint(request), reason: SHARE_ERROR_CODES.SCOPE_DENIED })
    return NextResponse.json(
      { error: 'Access denied', code: SHARE_ERROR_CODES.SCOPE_DENIED },
      { status: 403 },
    )
  }

  return null
}
