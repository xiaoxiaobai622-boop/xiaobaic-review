const INVALID_WATERMARK_CHARACTER_PATTERN = /[^\p{L}\p{M}\p{N}\s\-_.()，。！？：；、]/gu

export function getInvalidWatermarkCharacters(text: string): string[] {
  return [...new Set(text.match(INVALID_WATERMARK_CHARACTER_PATTERN) ?? [])]
}

export function stripInvalidWatermarkCharacters(text: string): string {
  return text.replace(INVALID_WATERMARK_CHARACTER_PATTERN, '')
}
