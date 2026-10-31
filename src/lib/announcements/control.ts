import { prisma } from '@/lib/db'

export interface PublicAnnouncementControl {
  bannerModalPaused: boolean
  modalMaxPerDay: number
  modalCooldownMinutes: number
  modalMaxShowsPerUser: number
  toastMaxPriority: number
}

export async function getAnnouncementControl() {
  return prisma.announcementControl.upsert({
    where: { id: 'global' },
    create: { id: 'global' },
    update: {},
  })
}

export function toPublicControl(control: {
  bannerModalPaused: boolean
  modalMaxPerDay: number
  modalCooldownMinutes: number
  modalMaxShowsPerUser: number
  toastMaxPriority: number
}): PublicAnnouncementControl {
  return {
    bannerModalPaused: control.bannerModalPaused,
    modalMaxPerDay: control.modalMaxPerDay,
    modalCooldownMinutes: control.modalCooldownMinutes,
    modalMaxShowsPerUser: control.modalMaxShowsPerUser,
    toastMaxPriority: control.toastMaxPriority,
  }
}
