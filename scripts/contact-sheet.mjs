// Contact sheet: for each product, the original photo next to each round's ad, every ad 520 px wide.
//   node scripts/contact-sheet.mjs tmp/p1 tmp/look/contact-sheet.jpg cans-white mug-white
import { readdirSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import sharp from "sharp";
const [dir, out, ...skus] = process.argv.slice(2);
mkdirSync(dirname(out), { recursive: true });
const CELL = 520, GAP = 16, LABEL = 30;
const rows = [];
for (const sku of skus) {
  const ads = readdirSync(dir).filter((f) => f.startsWith(`${sku}-`) && /-r[0-9].jpg$/.test(f)).sort();
  const cells = [await sharp(`demo-assets/catalogue/${sku}.jpg`).rotate().resize({ width: CELL, height: CELL, fit: "contain", background: "#ffffff" }).jpeg().toBuffer()];
  for (const f of ads) {
    const tagText = f.slice(sku.length + 1, -4).replace(/_/g, " ");
    const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="26"><rect width="${CELL}" height="26" fill="#000" fill-opacity="0.6"/><text x="8" y="18" font-family="Arial" font-size="15" fill="#fff">${tagText}</text></svg>`);
    cells.push(await sharp(`${dir}/${f}`).resize({ width: CELL }).composite([{ input: label, left: 0, top: CELL - 26 }]).jpeg().toBuffer());
  }
  rows.push({ sku, cells });
}
const width = GAP + Math.max(...rows.map((r) => r.cells.length)) * (CELL + GAP);
const height = GAP + rows.length * (CELL + LABEL + GAP);
const layers = [];
rows.forEach((r, i) => {
  const top = GAP + i * (CELL + LABEL + GAP);
  layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${LABEL}"><text x="${GAP}" y="22" font-family="Arial" font-size="20" font-weight="bold" fill="#222">${r.sku}: original, then each round</text></svg>`), left: 0, top });
  r.cells.forEach((c, j) => layers.push({ input: c, left: GAP + j * (CELL + GAP), top: top + LABEL }));
});
await sharp({ create: { width, height, channels: 3, background: "#e8e8e8" } }).composite(layers).jpeg({ quality: 88 }).toFile(out);
console.log(out, width, "x", height);
