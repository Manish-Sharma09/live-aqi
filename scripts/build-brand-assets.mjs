#!/usr/bin/env node
/**
 * Renders Live AQI brand assets (favicons, app icons, notification badge, OG image)
 * in the "soft sky" style. Uses Sharp (installed with Astro).
 *
 *   node scripts/build-brand-assets.mjs
 */
import sharp from 'sharp';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = join(root, 'public');
mkdirSync(join(pub, 'icons'), { recursive: true });

/*
 * The Live AQI mark (from the supplied icon.svg, November 2026): the Lucide
 * "cloud-sun" outline in white on a rounded tile that runs from sky cyan at the
 * top to deep sea navy at the bottom. Drawn on a 510-unit tile (the original's
 * size): radius 120, glyph box 426 wide, centred. Keep src/components/ui/Logo.astro
 * in step with these values.
 */
const TILE = 510;
const TILE_RADIUS = 120;
const GLYPH_BOX = 426;
const GLYPH_STROKE = 1.3; // in the glyph's own 24-unit grid
const CLOUD_SUN = [
  'M12 2v2',
  'm4.93 4.93 1.41 1.41',
  'M20 12h2',
  'm19.07 4.93-1.41 1.41',
  'M15.947 12.65a4 4 0 0 0-5.925-4.128',
  'M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z',
];
const TILE_GRADIENT = `<linearGradient id="tile" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#002024"/><stop offset="0.08" stop-color="#073f5e"/><stop offset="1" stop-color="#00d4ff"/></linearGradient>`;

/** The cloud-sun outline in its 24-unit grid. */
const glyph = (stroke = GLYPH_STROKE, color = '#fff3f3') =>
  `<g fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${CLOUD_SUN.map((d) => `<path d="${d}"/>`).join('')}</g>`;

/** Tile + glyph in TILE units (needs TILE_GRADIENT in <defs>). `inset` scales the glyph (maskable safe zone). */
const tileBody = ({ radius = TILE_RADIUS, inset = 1, stroke = GLYPH_STROKE } = {}) => {
  const unit = (GLYPH_BOX / 24) * inset;
  const offset = (TILE - 24 * unit) / 2;
  return `<rect width="${TILE}" height="${TILE}" rx="${radius}" fill="url(#tile)"/><g transform="translate(${offset} ${offset}) scale(${unit})">${glyph(stroke)}</g>`;
};

/** App mark as a standalone SVG. */
const mark = (size, opts) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${TILE} ${TILE}"><defs>${TILE_GRADIENT}</defs>${tileBody(opts)}</svg>`;

// Favicons render at 16–32 px, where the 1.3 line drops under a pixel: draw it a little heavier.
const FAVICON = { stroke: 1.8 };
writeFileSync(join(pub, 'favicon.svg'), mark(64, FAVICON));
const png = (svg, size) => sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
writeFileSync(join(pub, 'icons', 'icon-192.png'), await png(mark(192), 192));
writeFileSync(join(pub, 'icons', 'icon-512.png'), await png(mark(512), 512));
// iOS rounds the corners itself, and Android masks maskable icons: both get a square, full-bleed tile.
writeFileSync(join(pub, 'icons', 'apple-touch-icon.png'), await png(mark(180, { radius: 0 }), 180));
// Maskable safe zone is a circle of 40% radius; the glyph reaches ~12.75 grid units from its centre.
writeFileSync(join(pub, 'icons', 'icon-maskable-512.png'), await png(mark(512, { radius: 0, inset: 0.82 }), 512));

// Notification badge: monochrome silhouette (Android tints it) — the glyph alone, heavier.
const badge = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24">${glyph(2, '#fff')}</svg>`;
writeFileSync(join(pub, 'icons', 'badge-96.png'), await png(badge, 96));

// favicon.ico — one 32×32 PNG in an ICO container.
const ico = await png(mark(32, FAVICON), 32);
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt8(32, 6);
header.writeUInt8(32, 7);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(ico.length, 14);
header.writeUInt32LE(22, 18);
writeFileSync(join(pub, 'favicon.ico'), Buffer.concat([header, ico]));

// Open Graph image (1200×630): sky, sun, clouds, glass card with wordmark + scale.
const scale = ['#4CC27A', '#F2C94C', '#F2994A', '#EB5757', '#A66CD9', '#9B2C4A']
  .map((c, i) => `<rect x="${118 + i * 82}" y="420" width="76" height="14" rx="7" fill="${c}"/>`)
  .join('');
const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a7cbf2"/><stop offset="0.6" stop-color="#cde2f8"/><stop offset="1" stop-color="#e9f1fb"/></linearGradient>
    ${TILE_GRADIENT}
  </defs>
  <rect width="1200" height="630" fill="url(#sky)"/>
  <path d="M120 150h190a34 34 0 0 0 4-67.8A47 47 0 0 0 225 66a42 42 0 0 0-76 15.6A31 31 0 0 0 120 150Z" fill="#fff" opacity="0.92"/>
  <path d="M640 118h130a24 24 0 0 0 3-47.6A33 33 0 0 0 711 59a29 29 0 0 0-53 11A22 22 0 0 0 640 118Z" fill="#fff" opacity="0.8"/>
  <g fill="#8aa7cd">
    <rect x="0" y="470" width="70" height="160"/><rect x="74" y="430" width="56" height="200"/><rect x="760" y="380" width="60" height="250"/><rect x="826" y="300" width="70" height="330"/><rect x="900" y="410" width="80" height="220"/><rect x="986" y="350" width="64" height="280"/><rect x="1056" y="440" width="70" height="190"/><rect x="1130" y="400" width="70" height="230"/>
    <rect x="857" y="250" width="6" height="52" rx="3"/>
  </g>
  <g fill="#46679a"><circle cx="760" cy="640" r="60"/><circle cx="860" cy="640" r="52"/><circle cx="960" cy="650" r="66"/><circle cx="1070" cy="640" r="58"/><circle cx="1170" cy="645" r="60"/><rect x="700" y="600" width="500" height="30"/></g>
  <rect x="80" y="170" width="600" height="320" rx="34" fill="#ffffff" fill-opacity="0.66" stroke="#ffffff" stroke-width="2"/>
  <g transform="translate(120 217) scale(${56 / TILE})">${tileBody()}</g>
  <text x="196" y="264" fill="#1b2942" font-family="Helvetica, Arial, sans-serif" font-size="52" font-weight="800" letter-spacing="-1.5">Live AQI</text>
  <text x="118" y="342" fill="#1b2942" font-family="Helvetica, Arial, sans-serif" font-size="34" font-weight="700" letter-spacing="-0.5">Real-time air quality, everywhere</text>
  <text x="118" y="388" fill="#45546f" font-family="Helvetica, Arial, sans-serif" font-size="24">Live AQI, health advice and alerts for every city</text>
  ${scale}
  <text x="118" y="464" fill="#5f6d86" font-family="Helvetica, Arial, sans-serif" font-size="18">Good</text>
  <text x="604" y="464" fill="#5f6d86" font-family="Helvetica, Arial, sans-serif" font-size="18" text-anchor="end">Hazardous</text>
</svg>`;
const sun = await sharp(readFileSync(join(pub, 'art', 'sun.webp'))).resize(250).png().toBuffer();
const og = await sharp(Buffer.from(ogSvg)).composite([{ input: sun, left: 880, top: 24 }]).png({ compressionLevel: 9 }).toBuffer();
writeFileSync(join(pub, 'og.png'), og);
console.log('Brand assets written to public/');
