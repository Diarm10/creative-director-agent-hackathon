// Draws the demo images used by the tests and by the Demo set: simple flat illustrations, made by this script, so no third-party photo is
// needed in the repository. They are good enough for the tests and for trying the page; for a real ad, use your own product photos.
//
//   npx tsx scripts/make-demo-assets.ts            writes tests/unit/fixtures/*-cutout.png and demo-assets/catalogue/*.jpg
//
// The images are written only when they are missing, so running it twice changes nothing.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const svg = (w: number, h: number, body: string, bg = "") => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${bg}${body}</svg>`);

/** Each product as a drawing on a transparent canvas (a cut-out), in its own size. */
const products: Record<string, { w: number; h: number; body: string }> = {
  "mug-white": {
    w: 520, h: 470,
    body: `<ellipse cx="260" cy="440" rx="190" ry="18" fill="#000" fill-opacity="0.12"/><path d="M360 120 C470 110 480 300 360 310" fill="none" stroke="#dcdcdc" stroke-width="34"/><rect x="70" y="60" width="300" height="370" rx="26" fill="#ececec"/><rect x="70" y="60" width="300" height="370" rx="26" fill="none" stroke="#cfcfcf" stroke-width="3"/><ellipse cx="220" cy="62" rx="150" ry="20" fill="#f7f7f7" stroke="#cfcfcf" stroke-width="3"/><rect x="95" y="90" width="38" height="320" rx="19" fill="#fff" fill-opacity="0.6"/>`,
  },
  "notebook-black": {
    w: 420, h: 560,
    body: `<rect x="30" y="20" width="360" height="520" rx="10" fill="#1d1f1e"/><rect x="30" y="20" width="26" height="520" fill="#111312"/><rect x="60" y="30" width="3" height="500" fill="#3a3d3b"/><rect x="30" y="20" width="360" height="520" rx="10" fill="none" stroke="#2c2f2d" stroke-width="3"/>`,
  },
  "plant-snake": {
    w: 360, h: 700,
    body: `<g fill="#4c5b34" stroke="#2f3a20" stroke-width="3"><path d="M170 690 C130 500 140 260 175 20 C215 260 220 500 190 690Z"/><path d="M130 690 C60 520 70 330 100 150 C140 330 160 520 150 690Z"/><path d="M210 690 C250 500 250 300 275 120 C305 300 285 500 240 690Z"/><path d="M100 690 C20 560 20 420 30 300 C75 420 120 560 130 690Z"/><path d="M250 690 C320 560 330 440 330 330 C285 440 250 560 235 690Z"/></g><g stroke="#b9bf8a" stroke-width="5" fill="none"><path d="M175 650 C160 480 170 260 175 60"/><path d="M270 640 C270 500 275 300 275 160"/></g>`,
  },
  "pot-pilea": {
    w: 520, h: 640,
    body: `<ellipse cx="260" cy="610" rx="190" ry="20" fill="#000" fill-opacity="0.12"/><ellipse cx="260" cy="590" rx="190" ry="26" fill="#e7e4de"/><path d="M130 380 L390 380 L360 580 L160 580Z" fill="#f2f2f0" stroke="#d6d4ce" stroke-width="3"/><g fill="#5fae3b" stroke="#3b7a22" stroke-width="3"><circle cx="150" cy="250" r="78"/><circle cx="330" cy="200" r="86"/><circle cx="240" cy="110" r="70"/><circle cx="400" cy="320" r="62"/><circle cx="110" cy="360" r="56"/></g><g stroke="#3b7a22" stroke-width="6"><path d="M250 380 L150 280"/><path d="M270 380 L330 240"/><path d="M260 380 L240 150"/></g>`,
  },
  "stool-wooden": {
    w: 760, h: 460,
    body: `<rect x="2" y="2" width="756" height="84" rx="12" fill="#6a4a2d" stroke="#3f2b19" stroke-width="4"/><circle cx="60" cy="44" r="7" fill="#2d1f12"/><circle cx="700" cy="44" r="7" fill="#2d1f12"/><path d="M60 86 L20 458 L110 458 L150 86Z" fill="#7a5632" stroke="#3f2b19" stroke-width="4"/><path d="M610 86 L650 458 L740 458 L700 86Z" fill="#7a5632" stroke="#3f2b19" stroke-width="4"/><path d="M270 86 L290 400 L350 400 L340 86Z" fill="#5c3f25"/><path d="M420 86 L410 400 L470 400 L490 86Z" fill="#5c3f25"/><rect x="100" y="250" width="560" height="28" fill="#6a4a2d" stroke="#3f2b19" stroke-width="3"/>`,
  },
};

/** The size each test cut-out is made at (the tests were written for cut-outs about this big). */
const FIXTURE_SIZE: Record<string, [number, number]> = { "mug-white": [420, 411], "notebook-black": [271, 420], "plant-snake": [219, 420], "pot-pilea": [299, 372], "stool-wooden": [420, 284] };

/** The catalogue photos: a product on a plain ground, 1200 by 1200. */
const photos: Record<string, string> = {
  "pot-pilea": "pot-pilea", "plant-snake": "plant-snake", "mug-white": "mug-white", "notebook-black": "notebook-black", "stool-wooden": "stool-wooden",
};
const extra: Record<string, { bg: string; body: string }> = {
  "cans-white": { bg: "#ece9e4", body: `<g><rect x="380" y="260" width="190" height="640" rx="24" fill="#f4f4f2" stroke="#d3d1cc" stroke-width="4"/><rect x="380" y="240" width="190" height="40" rx="14" fill="#c9c9c6"/><rect x="640" y="330" width="190" height="600" rx="24" fill="#f4f4f2" stroke="#d3d1cc" stroke-width="4" transform="rotate(14 735 630)"/></g>` },
  "tote-jute": { bg: "#efece6", body: `<path d="M420 430 C420 130 560 130 560 430 M640 430 C640 130 780 130 780 430" transform="translate(-130 40)" fill="none" stroke="#8d8d8d" stroke-width="26"/><rect x="250" y="450" width="700" height="640" fill="#cfae75" stroke="#a98b57" stroke-width="5"/>` },
  "lamp-table": { bg: "#1f2a24", body: `<ellipse cx="600" cy="1060" rx="150" ry="26" fill="#111"/><path d="M600 1050 L520 560 L760 330" fill="none" stroke="#191919" stroke-width="22"/><circle cx="520" cy="560" r="16" fill="#c9a24a"/><circle cx="760" cy="330" r="16" fill="#c9a24a"/><path d="M760 330 L690 430 L820 470Z M690 430 L735 560 L820 470 L735 560Z" fill="none" stroke="#222" stroke-width="6"/><polygon points="760,300 680,400 740,520 860,470 850,370" fill="#fff" fill-opacity="0.2" stroke="#222" stroke-width="6"/>` },
  "flask-steel": { bg: "#efefec", body: `<rect x="470" y="150" width="260" height="70" rx="18" fill="#b6b9bb" stroke="#8d9092" stroke-width="4"/><path d="M520 150 C520 80 680 80 680 150" fill="none" stroke="#8d9092" stroke-width="18"/><rect x="450" y="220" width="300" height="840" rx="70" fill="#c3c7c9" stroke="#8d9092" stroke-width="5"/><rect x="490" y="250" width="50" height="780" rx="25" fill="#fff" fill-opacity="0.5"/>` },
  "pouch-in-hand": { bg: "#e8e6e1", body: `<path d="M360 300 L840 300 L810 960 L390 960Z" fill="#4f8a4c" stroke="#386a36" stroke-width="5"/><circle cx="600" cy="360" r="22" fill="#e8e6e1"/><rect x="360" y="296" width="480" height="30" fill="#3d7040"/>` },
  "still-life-group": { bg: "#efece6", body: `<rect x="200" y="800" width="800" height="40" rx="12" fill="#cdb48a"/><rect x="260" y="460" width="190" height="340" rx="70" fill="#f1ece0" stroke="#d3cab6" stroke-width="4"/><rect x="520" y="560" width="170" height="240" rx="60" fill="#f7f4ec" stroke="#d3cab6" stroke-width="4"/><rect x="760" y="600" width="130" height="200" rx="20" fill="#fff" stroke="#d3cab6" stroke-width="4"/><rect x="820" y="570" width="10" height="34" fill="#444"/>` },
  "busy-background": { bg: "", body: `<defs><pattern id="p" width="120" height="120" patternUnits="userSpaceOnUse"><rect width="120" height="120" fill="#2f6b3a"/><circle cx="30" cy="30" r="26" fill="#d8d84a"/><circle cx="90" cy="90" r="30" fill="#e8e8d0"/></pattern></defs><rect width="1200" height="1200" fill="url(#p)"/><rect x="480" y="520" width="240" height="560" rx="40" fill="#f6f6f2" stroke="#cfcfc8" stroke-width="4"/><rect x="530" y="400" width="140" height="130" rx="20" fill="#c9b36a"/><ellipse cx="600" cy="330" rx="46" ry="90" fill="#fafafa" stroke="#cfcfc8" stroke-width="4"/>` },
};

async function main() {
  mkdirSync("tests/unit/fixtures", { recursive: true });
  mkdirSync("demo-assets/catalogue", { recursive: true });
  let written = 0;
  for (const [name, p] of Object.entries(products)) {
    const f = `tests/unit/fixtures/${name}-cutout.png`;
    if (!existsSync(f)) { const [fw, fh] = FIXTURE_SIZE[name]; writeFileSync(f, await sharp(svg(p.w, p.h, p.body)).resize({ width: fw, height: fh, fit: "fill" }).png().toBuffer()); written++; }
  }
  for (const [name, productName] of Object.entries(photos)) {
    const f = `demo-assets/catalogue/${name}.jpg`;
    if (existsSync(f)) continue;
    const p = products[productName];
    const k = Math.min(900 / p.w, 900 / p.h);
    const cut = await sharp(svg(p.w, p.h, p.body)).resize({ width: Math.round(p.w * k), height: Math.round(p.h * k) }).png().toBuffer();
    const left = Math.round((1200 - Math.round(p.w * k)) / 2);
    const top = Math.round((1200 - Math.round(p.h * k)) / 2);
    writeFileSync(f, await sharp({ create: { width: 1200, height: 1200, channels: 3, background: "#ebe8e2" } }).composite([{ input: cut, left, top }]).jpeg({ quality: 88 }).toBuffer());
    written++;
  }
  for (const [name, e] of Object.entries(extra)) {
    const f = `demo-assets/catalogue/${name}.jpg`;
    if (existsSync(f)) continue;
    writeFileSync(f, await sharp(svg(1200, 1200, e.body, e.bg ? `<rect width="1200" height="1200" fill="${e.bg}"/>` : "")).jpeg({ quality: 88 }).toBuffer());
    written++;
  }
  console.log(`${written} image${written === 1 ? "" : "s"} written`);
}
await main();
