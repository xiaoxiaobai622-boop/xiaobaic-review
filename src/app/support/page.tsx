import type { Viewport } from 'next'
import { SupportEmbed } from './SupportEmbed'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function SupportPage() {
  return <SupportEmbed />
}
