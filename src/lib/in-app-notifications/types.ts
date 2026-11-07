export type InAppEventType =
  | 'COMMENT_NEW'
  | 'COMMENT_REPLY'
  | 'COMMENT_MENTION'
  | 'CLIENT_UPLOAD'
  | 'VIDEO_UPLOADED'
  | 'VIDEO_VERSION'
  | 'VIDEO_APPROVED'
  | 'VIDEO_UNAPPROVED'
  | 'PROJECT_APPROVED'
  | 'PROJECT_UNAPPROVED'
  | 'DUE_DATE_REMINDER'

export type InAppCategory = 'TEAM' | 'MENTION'

export interface InAppRecipient {
  userId: string
  name: string | null
  email: string | null
}

export interface InAppPayload {
  projectTitle?: string
  videoName?: string
  timecode?: string
  versionLabel?: string
  content?: string
  fileNames?: string[]
  count?: number
  visibility?: 'PUBLIC' | 'INTERNAL'
  [key: string]: unknown
}

export interface NotificationDraft {
  eventType: InAppEventType
  category: InAppCategory
  teamId: string
  projectId?: string | null
  videoId?: string | null
  commentId?: string | null
  actorUserId?: string | null
  actorName?: string | null
  recipient: InAppRecipient
  title: string
  body?: string | null
  deepLink?: string | null
  aggregateKey?: string | null
  aggregateTitle?: (count: number) => string
  aggregateBody?: (count: number, payload?: InAppPayload | null) => string | null
  dedupeKey: string
  payload?: InAppPayload | null
  createdAt?: Date
}

export interface EmitInAppResult {
  insertedEvents: number
  writtenNotifications: number
  recipients: number
}

export const IN_APP_CATEGORIES: InAppCategory[] = ['TEAM', 'MENTION']
