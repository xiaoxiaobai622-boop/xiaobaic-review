/**
 * The 逐帧审阅 mark, drawn (not referenced) so the same bytes serve the favicon
 * routes and the email PNG. `MARK_BODY` is the vector from the owner's chosen logo
 * pack (`01-blue-cyan-icon.svg`, six rounded slabs in blue→cyan) with its gradient
 * ids namespaced, so two marks on one page cannot collide. The palette is fixed by
 * design: the admin's accent colour never reaches the mark.
 */
const MARK_BODY = `<defs><linearGradient id="lg0" x1=".12" y1="0" x2=".85" y2="1"><stop stop-color="#36a2d8" /><stop offset=".45" stop-color="#0A8DD0" /><stop offset="1" stop-color="#0b81bd" /></linearGradient><linearGradient id="lg1" x1=".12" y1="0" x2=".85" y2="1"><stop stop-color="#40c5d9" /><stop offset=".45" stop-color="#16B8D1" /><stop offset="1" stop-color="#16a7be" /></linearGradient><linearGradient id="lg2" x1=".12" y1="0" x2=".85" y2="1"><stop stop-color="#62d2c2" /><stop offset=".45" stop-color="#40C8B5" /><stop offset="1" stop-color="#3bb5a5" /></linearGradient><linearGradient id="lg3" x1=".12" y1="0" x2=".85" y2="1"><stop stop-color="#8bdfcf" /><stop offset=".45" stop-color="#71D8C5" /><stop offset="1" stop-color="#66c3b3" /></linearGradient><linearGradient id="lg4" x1=".12" y1="0" x2=".85" y2="1"><stop stop-color="#579dd8" /><stop offset=".45" stop-color="#3287D0" /><stop offset="1" stop-color="#2f7cbd" /></linearGradient><linearGradient id="lg5" x1=".12" y1="0" x2=".85" y2="1"><stop stop-color="#798adb" /><stop offset=".45" stop-color="#5B70D3" /><stop offset="1" stop-color="#5368c0" /></linearGradient></defs><path d="M110 34H149C158 34 162 43 156 50L134 77C131 81 127 83 122 83H86C77 83 73 74 79 67L101 40C104 36 106 34 110 34Z" fill="url(#lg0)" transform="rotate(0 128 128) translate(118 58) scale(.85) translate(-118 -58)" /><path d="M110 34H149C158 34 162 43 156 50L134 77C131 81 127 83 122 83H86C77 83 73 74 79 67L101 40C104 36 106 34 110 34Z" fill="url(#lg1)" transform="rotate(60 128 128) translate(118 58) scale(.85) translate(-118 -58)" /><path d="M110 34H149C158 34 162 43 156 50L134 77C131 81 127 83 122 83H86C77 83 73 74 79 67L101 40C104 36 106 34 110 34Z" fill="url(#lg2)" transform="rotate(120 128 128) translate(118 58) scale(.85) translate(-118 -58)" /><path d="M110 34H149C158 34 162 43 156 50L134 77C131 81 127 83 122 83H86C77 83 73 74 79 67L101 40C104 36 106 34 110 34Z" fill="url(#lg3)" transform="rotate(180 128 128) translate(118 58) scale(.85) translate(-118 -58)" /><path d="M110 34H149C158 34 162 43 156 50L134 77C131 81 127 83 122 83H86C77 83 73 74 79 67L101 40C104 36 106 34 110 34Z" fill="url(#lg4)" transform="rotate(240 128 128) translate(118 58) scale(.85) translate(-118 -58)" /><path d="M110 34H149C158 34 162 43 156 50L134 77C131 81 127 83 122 83H86C77 83 73 74 79 67L101 40C104 36 106 34 110 34Z" fill="url(#lg5)" transform="rotate(300 128 128) translate(118 58) scale(.85) translate(-118 -58)" />`

/**
 * The same mark, scaled up to fill ~92% of the canvas (the artwork itself only
 * covers 71%, measured). Favicon and PWA slots render at 16–32px, where that
 * padding is the difference between a ring and a smudge; in-page marks and the
 * email logo keep the artwork's own breathing room.
 */
const FAVICON_FILL = 0.92 / 0.707

export function buildFaviconSvg(size: number): string {
  return buildLogoSvg(size).replace(
    MARK_BODY,
    `<g transform="translate(128 128) scale(${FAVICON_FILL.toFixed(3)}) translate(-128 -128)">${MARK_BODY}</g>`,
  )
}

export function buildLogoSvg(size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256" role="img" aria-label="逐帧审阅">${MARK_BODY}</svg>`
}

/**
 * Storage keys for the branding images — declared once because the route that
 * writes a cache and the routes that invalidate it used to spell the names
 * separately and one of them drifted (10-08 audit item 8).
 */
export const LOGO_SOURCE_KEY = 'branding/logo.svg'
/** Rasterised copy of the operator's uploaded SVG, kept in the same store. */
export const LOGO_PNG_KEY = 'branding/logo.png'
