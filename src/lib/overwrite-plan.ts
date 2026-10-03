import { FILE_LIMITS } from './file-validation'

/**
 * The rules behind 「把选择相同名字的视频一键覆盖上去」, kept out of the component so
 * they can be exercised without a browser.
 */

export type CollectableFile = {
  fileName: string
  fileType: string | null
  transcodeStatus: string
}

export type OverwriteMatch = {
  uploadId: string
  fileName: string
  videoName: string
}

export type OverwritePlan = {
  matches: OverwriteMatch[]
  skipped: Array<{ uploadId: string; fileName: string }>
}

export function fileNameWithoutExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.')
  return (lastDot > 0 ? fileName.slice(0, lastDot) : fileName).trim()
}

export function isVideoUpload(upload: { fileName: string; fileType: string | null }): boolean {
  const lowerName = upload.fileName.toLowerCase()
  const extension = lowerName.includes('.') ? lowerName.slice(lowerName.lastIndexOf('.')) : ''
  return upload.fileType?.toLowerCase().startsWith('video/') || FILE_LIMITS.ALLOWED_EXTENSIONS.includes(extension)
}

/**
 * Matching is on the display name against the asset names of the same project, case
 * insensitively. The returned name is the asset's own spelling, so an overwrite keeps
 * the group it belongs to instead of opening a second one that differs only by case.
 */
export function findTargetVideoName(fileName: string, videoNames: string[]): string | null {
  const suggestedName = fileNameWithoutExtension(fileName)
  return videoNames.find(name => name.toLowerCase() === suggestedName.toLowerCase()) || null
}

/**
 * A file with no same-name asset is skipped rather than offered as a new asset: 「覆盖」
 * is the promise the button makes, and silently creating footage the user never named
 * is how a batch turns into a mess. The single-file dialog stays the place for that.
 * A file still transcoding is excluded because the server refuses it outright.
 */
export function buildOverwritePlan(
  uploads: Array<{ id: string } & CollectableFile>,
  videoNames: string[]
): OverwritePlan {
  const matches: OverwriteMatch[] = []
  const skipped: Array<{ uploadId: string; fileName: string }> = []
  for (const upload of uploads) {
    const videoName = upload.transcodeStatus === 'PROCESSING' || !isVideoUpload(upload)
      ? null
      : findTargetVideoName(upload.fileName, videoNames)
    if (videoName) matches.push({ uploadId: upload.id, fileName: upload.fileName, videoName })
    else skipped.push({ uploadId: upload.id, fileName: upload.fileName })
  }
  return { matches, skipped }
}
