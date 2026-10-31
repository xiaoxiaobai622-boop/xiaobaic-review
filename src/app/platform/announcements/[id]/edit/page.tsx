'use client'

import { useParams } from 'next/navigation'
import AnnouncementForm from '@/components/announcements/AnnouncementForm'

export default function EditAnnouncementPage() {
  const params = useParams()
  const id = Array.isArray(params?.id) ? params.id[0] : String(params?.id || '')
  return <AnnouncementForm announcementId={id} />
}
