// Generates Nookleus iOS app-icon candidates (1024x1024, opaque) from a
// vector recreation of the atom mark in public/nookleus-icon.png.
// Run: node design/app-icon/generate.mjs
import sharp from 'sharp'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = dirname(fileURLToPath(import.meta.url))
mkdirSync(OUT, { recursive: true })

// Atom mark: two crossed elliptical orbits + electron dots + nucleus sphere.
// Electron dot positions are parametric points on the orbit ellipse
// (t=-30deg and t=170deg), placed inside the orbit's rotation group so they
// always sit exactly on the stroke.
function mark({ orbit, nucleusTop, nucleusBottom, highlight, glow }) {
  const glowEl = glow
    ? `<circle cx="512" cy="512" r="330" fill="url(#glow)"/>`
    : ''
  return `
  ${glowEl}
  <g stroke="${orbit}" stroke-width="62" fill="none">
    <ellipse cx="512" cy="512" rx="430" ry="170" transform="rotate(-32 512 512)"/>
    <ellipse cx="512" cy="512" rx="430" ry="170" transform="rotate(32 512 512)"/>
  </g>
  <g fill="${orbit}" transform="rotate(-32 512 512)">
    <circle cx="884" cy="427" r="46"/>
    <circle cx="89" cy="483" r="46"/>
  </g>
  <circle cx="512" cy="512" r="205" fill="url(#nucleus)"/>
  <ellipse cx="438" cy="421" rx="76" ry="48" fill="${highlight}" opacity="0.95"
           transform="rotate(-28 438 421)"/>
  <defs>
    <radialGradient id="nucleus" cx="0.36" cy="0.30" r="0.95">
      <stop offset="0" stop-color="${nucleusTop}"/>
      <stop offset="1" stop-color="${nucleusBottom}"/>
    </radialGradient>
    <radialGradient id="glow">
      <stop offset="0" stop-color="#9CCB4A" stop-opacity="0.32"/>
      <stop offset="1" stop-color="#9CCB4A" stop-opacity="0"/>
    </radialGradient>
  </defs>`
}

const candidates = {
  // 1. Original palette on a clean off-white field — closest to the web lockup.
  light: {
    bg: `<defs><radialGradient id="bg" cx="0.5" cy="0.35" r="1">
           <stop offset="0" stop-color="#FFFFFF"/>
           <stop offset="1" stop-color="#EDF2E2"/>
         </radialGradient></defs>
         <rect width="1024" height="1024" fill="url(#bg)"/>`,
    mark: mark({
      orbit: '#2E5230',
      nucleusTop: '#C9E47A',
      nucleusBottom: '#8AB83C',
      highlight: '#FFFFFF',
    }),
  },
  // 2. Deep forest-green field, cream orbits, glowing lime nucleus.
  forest: {
    bg: `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
           <stop offset="0" stop-color="#30603B"/>
           <stop offset="1" stop-color="#152F1D"/>
         </linearGradient></defs>
         <rect width="1024" height="1024" fill="url(#bg)"/>`,
    mark: mark({
      orbit: '#F2F6E8',
      nucleusTop: '#D6EE88',
      nucleusBottom: '#93C044',
      highlight: '#FFFFFF',
      glow: true,
    }),
  },
  // 3. Lime field, dark-green mark, dark sphere with the white blob highlight.
  lime: {
    bg: `<defs><linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1">
           <stop offset="0" stop-color="#B7DD62"/>
           <stop offset="1" stop-color="#7DAE36"/>
         </linearGradient></defs>
         <rect width="1024" height="1024" fill="url(#bg)"/>`,
    mark: mark({
      orbit: '#1F3D22',
      nucleusTop: '#33592F',
      nucleusBottom: '#16301A',
      highlight: '#F4F9E6',
    }),
  },
  // 4. Near-black green, lime mark, glow — premium dark look.
  midnight: {
    bg: `<defs><radialGradient id="bg" cx="0.5" cy="0.4" r="1">
           <stop offset="0" stop-color="#16331E"/>
           <stop offset="1" stop-color="#06110A"/>
         </radialGradient></defs>
         <rect width="1024" height="1024" fill="url(#bg)"/>`,
    mark: mark({
      orbit: '#A6D14F',
      nucleusTop: '#DCF192',
      nucleusBottom: '#8FBE3F',
      highlight: '#FFFFFF',
      glow: true,
    }),
  },
}

for (const [name, { bg, mark }] of Object.entries(candidates)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${bg}${mark}</svg>`
  const svgPath = join(OUT, `${name}.svg`)
  writeFileSync(svgPath, svg)
  await sharp(Buffer.from(svg))
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .png()
    .toFile(join(OUT, `${name}.png`))
  console.log(`rendered ${name}.png`)
}
