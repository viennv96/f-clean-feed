// Generates the extension icon as SVG for each size. The 128px store icon
// keeps Chrome Web Store's 16px transparent margin (96px artwork); toolbar
// sizes fill the canvas and drop detail that would blur at small sizes.
//   node store/src/icon.mjs <outDir>
import { writeFileSync } from "node:fs";

const NAVY_A = "#12355E";
const NAVY_B = "#0B1F3A";
const EMERALD = "#10B981";

// `square`: full-bleed tile with no rounding, for platforms that apply their
// own mask (iOS home screen, Android adaptive icons).
function svg(size, { square = false } = {}) {
  const pad = square ? 0 : size === 128 ? 16 : size >= 48 ? 2 : size >= 32 ? 1 : 0;
  const s = (size - pad * 2) / 96; // artwork drawn on a 96-unit tile
  const detail = size >= 48 ? "full" : size >= 32 ? "mid" : "min";
  const t = (v) => +(pad + v * s).toFixed(2);
  const d = (v) => +(v * s).toFixed(2);

  const card = { x: 18, y: 20, w: 52, h: 58 };
  const badge = { cx: 68, cy: 70, r: detail === "min" ? 20 : 17 };

  const lines =
    detail === "min"
      ? `<rect x="${t(26)}" y="${t(34)}" width="${d(36)}" height="${d(8)}" rx="${d(4)}" fill="#C7D2E0"/>`
      : detail === "mid"
        ? `<rect x="${t(26)}" y="${t(30)}" width="${d(36)}" height="${d(7)}" rx="${d(3.5)}" fill="#C7D2E0"/>
           <rect x="${t(26)}" y="${t(44)}" width="${d(26)}" height="${d(7)}" rx="${d(3.5)}" fill="#DFE6EF"/>`
        : `<circle cx="${t(30)}" cy="${t(32)}" r="${d(5.5)}" fill="#C7D2E0"/>
           <rect x="${t(40)}" y="${t(29)}" width="${d(22)}" height="${d(6)}" rx="${d(3)}" fill="#C7D2E0"/>
           <rect x="${t(26)}" y="${t(46)}" width="${d(36)}" height="${d(5)}" rx="${d(2.5)}" fill="#DFE6EF"/>
           <rect x="${t(26)}" y="${t(56)}" width="${d(24)}" height="${d(5)}" rx="${d(2.5)}" fill="#DFE6EF"/>`;

  const check =
    detail === "min"
      ? ""
      : `<path d="M${t(60)} ${t(70)} L${t(66)} ${t(76)} L${t(77)} ${t(64)}" fill="none" stroke="#fff" stroke-width="${d(5)}" stroke-linecap="round" stroke-linejoin="round"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${NAVY_A}"/><stop offset="1" stop-color="${NAVY_B}"/>
    </linearGradient>
    <linearGradient id="e" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#34D399"/><stop offset="1" stop-color="${EMERALD}"/>
    </linearGradient>
  </defs>
  <rect x="${pad}" y="${pad}" width="${size - pad * 2}" height="${size - pad * 2}" rx="${square ? 0 : d(22)}" fill="url(#g)"/>
  ${size >= 48 && !square ? `<rect x="${pad}" y="${pad}" width="${size - pad * 2}" height="${size - pad * 2}" rx="${d(22)}" fill="none" stroke="#ffffff" stroke-opacity=".08" stroke-width="${d(1.5)}"/>` : ""}
  <rect x="${t(card.x)}" y="${t(card.y)}" width="${d(card.w)}" height="${d(card.h)}" rx="${d(9)}" fill="#ffffff"/>
  ${lines}
  <circle cx="${t(badge.cx)}" cy="${t(badge.cy)}" r="${d(badge.r + 4)}" fill="${NAVY_B}"/>
  <circle cx="${t(badge.cx)}" cy="${t(badge.cy)}" r="${d(badge.r)}" fill="url(#e)"/>
  ${check}
</svg>`;
}

const out = process.argv[2] || ".";
for (const size of [16, 32, 48, 128, 512]) writeFileSync(`${out}/icon-${size}.svg`, svg(size));
// Website: SVG favicon, apple-touch-icon and web-manifest icons.
writeFileSync(`${out}/favicon.svg`, svg(32));
for (const size of [180, 192, 512]) writeFileSync(`${out}/icon-square-${size}.svg`, svg(size, { square: true }));
