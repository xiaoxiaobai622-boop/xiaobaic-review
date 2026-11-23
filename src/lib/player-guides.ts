export type GuideAspect = 'off' | '2.35' | '1.85' | '16:9' | '9:16' | '4:3' | '1:1'

export const GUIDE_ASPECT_OPTIONS: GuideAspect[] = ['2.35', '1.85', '16:9', '9:16', '4:3', '1:1', 'off']

export function guideRatio(aspect: GuideAspect): number | null {
  switch (aspect) {
    case '2.35':
      return 2.35
    case '1.85':
      return 1.85
    case '16:9':
      return 16 / 9
    case '9:16':
      return 9 / 16
    case '4:3':
      return 4 / 3
    case '1:1':
      return 1
    default:
      return null
  }
}

export interface GuideRect {
  left: number
  top: number
  width: number
  height: number
}

/** The object-contain content box of a video inside its player surface. */
export function containedVideoRect(
  boxWidth: number,
  boxHeight: number,
  videoWidth: number,
  videoHeight: number,
): GuideRect | null {
  if (boxWidth <= 0 || boxHeight <= 0 || videoWidth <= 0 || videoHeight <= 0) return null
  const scale = Math.min(boxWidth / videoWidth, boxHeight / videoHeight)
  const width = videoWidth * scale
  const height = videoHeight * scale
  return {
    left: (boxWidth - width) / 2,
    top: (boxHeight - height) / 2,
    width,
    height,
  }
}

/** Largest centred rectangle of `aspect` that fits inside the video content box. */
export function guideRectWithin(content: GuideRect, aspect: GuideAspect): GuideRect | null {
  const ratio = guideRatio(aspect)
  if (!ratio) return null
  const contentRatio = content.width / content.height
  const width = contentRatio > ratio ? content.height * ratio : content.width
  const height = contentRatio > ratio ? content.height : content.width / ratio
  return {
    left: content.left + (content.width - width) / 2,
    top: content.top + (content.height - height) / 2,
    width,
    height,
  }
}
