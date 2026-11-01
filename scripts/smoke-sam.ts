// Cuts a product out of a photo with SAM 3.1 and writes tmp/smoke-cutout.png.
//
//   npm run smoke:sam -- path/to/photo.jpg "earbuds case"
//   npm run smoke:sam                         (uses the placeholder from npm run placeholder)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cutOutProduct } from "../src/lib/meta/segment.ts";

const [file = "tmp/placeholder-product.jpg", noun = "charging case"] = process.argv.slice(2);
const cut = await cutOutProduct(noun, readFileSync(file));
if (!cut) {
  console.error(`SAM found no "${noun}" in ${file}. Try a plainer noun phrase, such as the product's type.`);
  process.exit(1);
}
mkdirSync("tmp", { recursive: true });
writeFileSync("tmp/smoke-cutout.png", cut.png);
console.error(`Found it with the ${cut.method} prompt: ${cut.box.width}x${cut.box.height} px, ${cut.matches} match(es). Wrote tmp/smoke-cutout.png`);
