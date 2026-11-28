export const CARD_ART_PALETTES = [
  { a: '#3b2a8f', b: '#7c5cf0' },
  { a: '#e0566b', b: '#ff8a6b' },
  { a: '#0f5c73', b: '#1fa0a0' },
  { a: '#1f3f8f', b: '#3f7be0' },
  { a: '#5a2d6e', b: '#b0527f' },
  { a: '#274a3a', b: '#3f8f6a' },
]

const CARD_ART_BY_CODE: Record<string, number> = {
  '001': 0, '006': 1, '004': 2, '005': 3, '003': 4, '002': 5,
}

export function cardArtFor(project: { id: string; projectCode?: string | null }) {
  const known = project.projectCode ? CARD_ART_BY_CODE[project.projectCode] : undefined
  if (known !== undefined) return CARD_ART_PALETTES[known]
  let hash = 0
  for (let i = 0; i < project.id.length; i += 1) hash = (hash * 31 + project.id.charCodeAt(i)) >>> 0
  return CARD_ART_PALETTES[hash % CARD_ART_PALETTES.length]
}
