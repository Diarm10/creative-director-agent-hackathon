// Draws a generic earbuds charging case (an illustration, not a photo of any real product) on a plain wall,
// for trying the product flow without a photo of your own. Writes tmp/placeholder-product.jpg.
//
//   npm run placeholder
import { mkdirSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";

const W = 1200;
const H = 1200;

// A rounded case with a lid seam, a small light and a soft shadow, lit from the top left.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9d4ca"/><stop offset="1" stop-color="#c4beb2"/></linearGradient>
    <linearGradient id="base" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f7a8f"/><stop offset="0.55" stop-color="#2f566b"/><stop offset="1" stop-color="#1f3b4a"/></linearGradient>
    <linearGradient id="lid" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6b97ab"/><stop offset="0.5" stop-color="#3f6c82"/><stop offset="1" stop-color="#2a4d5f"/></linearGradient>
    <radialGradient id="shine" cx="0.3" cy="0.2" r="0.7"><stop offset="0" stop-color="#ffffff" stop-opacity="0.35"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
    <filter id="blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="22"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#wall)"/>
  <ellipse cx="610" cy="905" rx="330" ry="46" fill="#000000" fill-opacity="0.35" filter="url(#blur)"/>
  <rect x="270" y="360" width="660" height="520" rx="150" fill="url(#base)"/>
  <path d="M270 520 Q270 360 420 360 L780 360 Q930 360 930 520 L930 580 L270 580 Z" fill="url(#lid)"/>
  <rect x="270" y="575" width="660" height="10" fill="#17303d" fill-opacity="0.8"/>
  <rect x="270" y="360" width="660" height="520" rx="150" fill="url(#shine)"/>
  <circle cx="600" cy="760" r="14" fill="#d8f2e6"/>
  <circle cx="600" cy="760" r="26" fill="#d8f2e6" fill-opacity="0.25"/>
</svg>`;

const png = new Resvg(svg).render().asPng();
mkdirSync("tmp", { recursive: true });
const jpeg = await sharp(png).jpeg({ quality: 90 }).toBuffer();
writeFileSync("tmp/placeholder-product.jpg", jpeg);
console.error(`Wrote tmp/placeholder-product.jpg (${jpeg.length} bytes). It is an illustration, not a photo of a real product.`);
