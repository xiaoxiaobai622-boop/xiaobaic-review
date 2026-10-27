export const MAX_CONCURRENT_UPLOADS = 3

/**
 * 「全部开始」的下一批：TUS 的上传函数会立即返回，只能用状态里的 uploading 数量算空位。
 * 暂停/失败/完成都算让位，下一批由状态变化再推进。
 */
export function pickUploadBatch(queue: string[], statuses: Record<string, string>, limit = MAX_CONCURRENT_UPLOADS): { start: string[]; rest: string[] } {
  const active = Object.values(statuses).filter((status) => status === 'uploading').length
  const room = Math.max(0, limit - active)
  return { start: queue.slice(0, room), rest: queue.slice(room) }
}
