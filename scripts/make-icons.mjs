// Renders the home-screen icons from one drawing. Run: node scripts/make-icons.mjs
// Needs Playwright with Chromium (npx playwright install chromium).
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// `require` also finds a globally installed Playwright.
const { chromium } = createRequire(import.meta.url)('playwright')

const out = fileURLToPath(new URL('../public/icons/', import.meta.url))

/** The Jarvis mark: an amber ring around a lit centre, on warm black. */
function mark({ size, ringRadius, bleed }) {
  const c = size / 2
  const r = size * ringRadius
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <defs>
      <radialGradient id="glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#f2a33a" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="#f2a33a" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${size}" height="${size}" fill="#0b0a09" ${bleed ? '' : `rx="${size * 0.22}"`}/>
    <circle cx="${c}" cy="${c}" r="${r * 1.7}" fill="url(#glow)"/>
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#f2a33a" stroke-width="${size * 0.07}"/>
    <circle cx="${c}" cy="${c}" r="${r * 0.32}" fill="#f2a33a"/>
  </svg>`
}

const icons = [
  // "any" icons: rounded tile, ring fills most of it.
  { file: 'icon-192.png', size: 192, ringRadius: 0.27, bleed: false, transparent: true },
  { file: 'icon-512.png', size: 512, ringRadius: 0.27, bleed: false, transparent: true },
  // Maskable: full-bleed background, artwork inside the central safe zone.
  { file: 'maskable-512.png', size: 512, ringRadius: 0.2, bleed: true, transparent: false },
  // iOS applies its own rounding: full-bleed, no transparency.
  { file: 'apple-touch-icon.png', size: 180, ringRadius: 0.25, bleed: true, transparent: false },
]

await mkdir(out, { recursive: true })
const browser = await chromium.launch()
try {
  for (const icon of icons) {
    const page = await browser.newPage({ viewport: { width: icon.size, height: icon.size }, deviceScaleFactor: 1 })
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${mark(icon)}</body></html>`,
    )
    await page.screenshot({ path: `${out}${icon.file}`, omitBackground: icon.transparent })
    await page.close()
    console.log(`wrote public/icons/${icon.file}`)
  }
} finally {
  await browser.close()
}
