import { prisma } from '../lib/db'
import { getRedis } from '../lib/redis'
import { enqueueExternalNotification } from '../lib/external-notifications/enqueueExternalNotification'
import { sendDueDateReminderEmail } from '../lib/email'
import { isSmtpConfigured } from '../lib/settings'
import { logError, logMessage } from '../lib/logging'
import { emitDueDateInAppNotification, logInAppEmitResult } from '../lib/in-app-notifications/emit'

const REDIS_KEY = 'due_date_reminder:last_check'
let firstRun = true

function findProjectsDueOn(from: Date, dueReminder: 'DAY_BEFORE' | 'WEEK_BEFORE') {
  return prisma.project.findMany({
    where: {
      dueDate: {
        gte: from,
        lt: new Date(from.getTime() + 86400000),
      },
      dueReminder,
      status: { notIn: ['APPROVED', 'ARCHIVED'] },
    },
    select: { id: true, title: true, dueDate: true, teamId: true },
  })
}

export async function processDueDateReminders() {
  const redis = getRedis()

  if (firstRun) {
    logMessage('[WORKER] Due date reminder check initialized')
    firstRun = false
  }

  // Only run once per day
  const lastCheck = await redis.get(REDIS_KEY)
  if (lastCheck) {
    const lastCheckDate = new Date(lastCheck)
    const now = new Date()
    if (lastCheckDate.toDateString() === now.toDateString()) {
      return // Already checked today
    }
  }

  logMessage('[WORKER] Running daily due date reminder check...')

  const now = new Date()
  now.setHours(0, 0, 0, 0)

  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const nextWeek = new Date(now)
  nextWeek.setDate(nextWeek.getDate() + 7)

  const dayBeforeProjects = await findProjectsDueOn(tomorrow, 'DAY_BEFORE')
  const weekBeforeProjects = await findProjectsDueOn(nextWeek, 'WEEK_BEFORE')

  const allReminders = [
    ...dayBeforeProjects.map(p => ({ ...p, reminderType: 'tomorrow' })),
    ...weekBeforeProjects.map(p => ({ ...p, reminderType: 'in 7 days' })),
  ]

  if (allReminders.length === 0) {
    await redis.set(REDIS_KEY, new Date().toISOString(), 'EX', 86400)
    logMessage(`[WORKER] Due date check complete — no reminders to send (${dayBeforeProjects.length} day-before, ${weekBeforeProjects.length} week-before)`)
    return
  }

  logMessage(`[WORKER] Found ${allReminders.length} due date reminder(s) to send`)

  let externalFailures = 0
  let emailFailures = 0

  const dayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

  // Send external notifications for each reminder
  for (const project of allReminders) {
    // In-app is independent of the external channel; a failed Apprise job
    // must not suppress the team's in-app reminder.
    void emitDueDateInAppNotification({
      projectId: project.id,
      dueDate: project.dueDate!,
      reminderType: project.reminderType,
      dayKey,
    }).then((emitResult) => logInAppEmitResult('due date', emitResult)).catch((emitError) => {
      logError(`[WORKER] Failed to emit in-app due date notification (projectId=${project.id})`, emitError)
    })

    try {
      const dueStr = new Date(project.dueDate!).toLocaleDateString()
      await enqueueExternalNotification({
        eventType: 'DUE_DATE_REMINDER',
        teamId: project.teamId,
        projectId: project.id,
        title: `Deadline Reminder: ${project.title}`,
        body: `"${project.title}" is due ${project.reminderType} (${dueStr})`,
        pushData: {
          projectId: project.id,
          projectTitle: project.title,
        },
      })
    } catch (notificationError) {
      externalFailures++
      logError(`[WORKER] Failed to enqueue due date reminder notification (projectId=${project.id})`, notificationError)
    }
  }

  // Send email reminders to all admins
  try {
    const smtpReady = await isSmtpConfigured()
    if (!smtpReady) {
      logMessage('[WORKER] SMTP not configured — skipping due date reminder emails')
    } else {
      for (const project of allReminders) {
        try {
          const adminEmails = await getProjectTeamAdminEmails(project.id)
          if (adminEmails.length === 0) {
            logMessage(`[WORKER] No team admin emails for project ${project.id} — skipping reminder email`)
            continue
          }
          const dueStr = new Date(project.dueDate!).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })
          await sendDueDateReminderEmail({
            adminEmails,
            projectTitle: project.title,
            dueDate: dueStr,
            reminderType: project.reminderType,
          })
        } catch (emailError) {
          emailFailures++
          logError(`[WORKER] Failed to send due date reminder email (projectId=${project.id})`, emailError)
        }
      }
    }
  } catch (error) {
    emailFailures++
    logError('[WORKER] Failed to send due date reminder emails', error)
  }

  const totalFailures = externalFailures + emailFailures
  if (totalFailures === 0) {
    await redis.set(REDIS_KEY, new Date().toISOString(), 'EX', 86400)
    logMessage(`[WORKER] Due date check complete — ${allReminders.length} reminder(s) processed`)
    return
  }

  await redis.set(REDIS_KEY, new Date().toISOString(), 'EX', 900)
  logMessage(`[WORKER] Due date check completed with ${totalFailures} failure(s); retry scheduled in 15 minutes`)
}
