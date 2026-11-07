import { prisma } from '@/lib/db'
import { isSmtpConfigured } from '@/lib/settings'
import { sendAdminClientUploadEmail } from '@/lib/email'
import { enqueueExternalNotification } from '@/lib/external-notifications/enqueueExternalNotification'
import { getAppDomain } from '@/lib/url'
import { getProjectTeamAdminContacts } from '@/lib/team-notification-recipients'
import { logError, logMessage } from '@/lib/logging'
import { emitClientUploadInAppNotification, logInAppEmitResult } from '@/lib/in-app-notifications/emit'
import { scheduleClientUploadBatch } from '@/lib/in-app-notifications/upload-batch'

interface UploadProject {
  id: string
  title: string
  slug?: string
  teamId: string
}

/**
 * One summary for one upload batch. Used by the debounced batch worker and as
 * the immediate fallback when the queue/Redis is unavailable.
 */
export async function sendClientUploadChannels(params: {
  project: UploadProject
  fileNames: string[]
  uploaderName?: string | null
  uploaderEmail?: string | null
}): Promise<void> {
  const { project, fileNames } = params
  const displayName = params.uploaderName || 'A client'
  const displayEmail = params.uploaderEmail || undefined
  const uniqueFiles = Array.from(new Set(fileNames.filter(Boolean)))

  const appDomain = await getAppDomain()
  const adminUrl = appDomain
    ? `${appDomain.replace(/\/$/, '')}/login?returnUrl=${encodeURIComponent(`/studio/projects/${project.id}`)}`
    : ''

  await enqueueExternalNotification({
    eventType: 'CLIENT_UPLOAD',
    teamId: project.teamId,
    projectId: project.id,
    title: uniqueFiles.length > 1 ? `New Uploads: ${project.title}` : `New Upload: ${project.title}`,
    body: [
      `${displayName}${displayEmail ? ` (${displayEmail})` : ''} uploaded ${uniqueFiles.length} file${uniqueFiles.length === 1 ? '' : 's'}`,
      `Files: ${uniqueFiles.slice(0, 8).join(', ')}${uniqueFiles.length > 8 ? `, +${uniqueFiles.length - 8} more` : ''}`,
      `Project: ${project.title}`,
      adminUrl ? `Link: ${adminUrl}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    notifyType: 'info',
    pushData: {
      projectTitle: project.title,
      projectId: project.id,
      videoName: `${uniqueFiles.length} file${uniqueFiles.length === 1 ? '' : 's'}`,
      authorName: displayName,
      email: displayEmail,
      url: adminUrl || undefined,
    },
  }).catch((err) => {
    logError('[UPLOAD-NOTIFICATION] Failed to enqueue external notification', err)
    throw err
  })

  const smtpConfigured = await isSmtpConfigured()
  if (!smtpConfigured) {
    logMessage('[UPLOAD-NOTIFICATION] Email skipped - SMTP not configured')
    return
  }

  const admins = await getProjectTeamAdminContacts(project.id)
  if (admins.length === 0) {
    logMessage('[UPLOAD-NOTIFICATION] No team admins to notify')
    return
  }

  const result = await sendAdminClientUploadEmail({
    adminEmails: admins.map((admin) => admin.email),
    uploaderName: displayName,
    uploaderEmail: displayEmail,
    projectTitle: project.title,
    projectId: project.id,
    fileNames: uniqueFiles,
  })

  if (result.success) {
    logMessage(`[UPLOAD-NOTIFICATION] ${result.message}`)
  } else {
    logError(`[UPLOAD-NOTIFICATION] Failed: ${result.message}`)
  }
}

/**
 * Reverse-share upload completion:
 *  - in-app feed immediately (aggregated per project/uploader/hour)
 *  - email/push/Apprise through a one-minute batch so 20 files do not create
 *    20 emails and 20 pushes
 *  - if the batch queue cannot be reached, send a one-file summary immediately
 */
export async function handleReverseShareUploadNotification(params: {
  projectId: string
  fileName: string
  uploaderName?: string | null
  uploaderEmail?: string | null
  uploadId?: string | null
}): Promise<void> {
  const { projectId, fileName, uploaderName, uploaderEmail, uploadId } = params

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, title: true, slug: true, teamId: true },
    })

    if (!project) {
      logMessage('[UPLOAD-NOTIFICATION] Project not found')
      return
    }

    void emitClientUploadInAppNotification({
      projectId,
      fileName,
      uploaderName,
      uploaderEmail,
      uploadId,
    }).then((result) => logInAppEmitResult('client upload', result)).catch((err) => {
      logError('[UPLOAD-NOTIFICATION] Failed to emit in-app notification', err)
    })

    try {
      await scheduleClientUploadBatch({
        projectId,
        fileName,
        uploaderName,
        uploaderEmail,
        uploadId,
      })
    } catch {
      logMessage('[UPLOAD-NOTIFICATION] Batch unavailable — sending immediate summary')
      await sendClientUploadChannels({
        project,
        fileNames: [fileName],
        uploaderName,
        uploaderEmail,
      })
    }
  } catch (error) {
    logError('[UPLOAD-NOTIFICATION] Error processing notification:', error)
  }
}
