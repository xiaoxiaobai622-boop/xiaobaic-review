// Browser-side container sniffing for video uploads.
//
// The upload allowlist advertises .mp4/.mov/.avi/.webm/.mkv and the worker
// validates content with `file-type` against all of those containers, but the
// pre-upload check used to recognise only ISO-BMFF atoms — so every .webm,
// .mkv and .avi was rejected as "not a video file" before it ever reached the
// server. This module keeps the browser guard in sync with the advertised list.
//
// It is a fast local failure path, not a security boundary: the worker still
// performs the authoritative magic-byte validation.

import { FILE_LIMITS } from './file-validation'

export type VideoContainerCheck = 'valid' | 'too-small' | 'not-video'

const HEADER_BYTES = 12

/**
 * Whether a picked/dropped file is worth queueing at all. Browsers disagree on
 * the MIME type they report for these containers (Safari reports an empty
 * string for anything it cannot play), so a MIME-only filter silently drops
 * real .mkv/.avi uploads. The extension is the advertised contract; the
 * container check below is what actually decides.
 */
export function isVideoCandidate(file: File): boolean {
  if (file.type.startsWith('video/')) return true
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  return FILE_LIMITS.ALLOWED_EXTENSIONS.includes(ext)
}

/** `<input accept>` value matching `isVideoCandidate`. */
export const VIDEO_INPUT_ACCEPT = `video/*,${FILE_LIMITS.ALLOWED_EXTENSIONS.join(',')}`
// BMFF atoms that can legitimately open an .mp4/.mov stream.
const BMFF_ATOMS = ['ftyp', 'mdat', 'wide', 'free', 'moov']

// EBML header: every Matroska (.mkv) and WebM (.webm) file starts with it.
const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3]

function readHeader(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      if (event.target?.result) {
        resolve(new Uint8Array(event.target.result as ArrayBuffer))
      } else {
        reject(new Error('Failed to read file'))
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsArrayBuffer(file.slice(0, HEADER_BYTES))
  })
}

function asciiAt(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end))
}

function magicAt(bytes: Uint8Array, offset: number, magic: number[]): boolean {
  return magic.every((value, index) => bytes[offset + index] === value)
}

export async function checkVideoContainer(file: File): Promise<VideoContainerCheck> {
  const header = await readHeader(file)
  if (header.length < HEADER_BYTES) return 'too-small'

  // AVI is RIFF-framed, so the marker lives at offset 0 and the form type at 8.
  if (asciiAt(header, 0, 4) === 'RIFF' && asciiAt(header, 8, 12) === 'AVI ') return 'valid'

  if (magicAt(header, 0, EBML_MAGIC)) return 'valid'

  if (BMFF_ATOMS.includes(asciiAt(header, 4, 8))) return 'valid'

  return 'not-video'
}
