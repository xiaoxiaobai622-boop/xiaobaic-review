import { prisma } from './db'
import { getAutoApproveProject } from './settings'

/**
 * Re-derive `Project.status` from the video versions that are actually live.
 *
 * A project is APPROVED when every name-group has at least one approved version,
 * so the answer only depends on the current rows — which is also why every
 * mutation that changes those rows has to run this. Deleting the only approved
 * version of a group used to leave the project flagged APPROVED forever, and the
 * client kept showing 已批准 for a cut nobody signed off.
 *
 * A project with no videos left is not "all approved", it has nothing to review;
 * its status is left alone.
 */
export async function recomputeProjectApprovalStatus(projectId: string): Promise<void> {
  const [project, videos] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { status: true } }),
    prisma.video.findMany({
      where: { projectId },
      select: { id: true, name: true, approved: true, approvedAt: true },
    }),
  ])
  if (!project || videos.length === 0) return

  const approvedGroupNames = new Set<string>()
  for (const video of videos) {
    if (video.approved) approvedGroupNames.add(video.name)
  }
  const allGroupsApproved = videos.every((video) => approvedGroupNames.has(video.name))

  if (allGroupsApproved) {
    // Promotion stays behind the platform switch: a project is only auto-certified
    // when the team opted into it, same as the explicit approve route.
    if (!(await getAutoApproveProject()) || project.status === 'APPROVED') return
    const newest = videos
      .filter((video) => video.approved)
      .reduce((best, video) => (
        best?.approvedAt && video.approvedAt && best.approvedAt >= video.approvedAt ? best : video
      ))
    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'APPROVED', approvedAt: newest.approvedAt ?? new Date(), approvedVideoId: newest.id },
    })
    return
  }

  if (project.status === 'APPROVED') {
    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'IN_REVIEW', approvedAt: null, approvedVideoId: null },
    })
  }
}
