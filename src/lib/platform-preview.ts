export type PreviewPlatform = 'off' | 'douyin'

export const PLATFORM_PREVIEW_OPTIONS: Array<{ value: 'douyin'; label: string }> = [
  { value: 'douyin', label: '抖音' },
]

export function platformLabel(platform: PreviewPlatform): string {
  return platform === 'douyin' ? '抖音' : 'Off'
}
