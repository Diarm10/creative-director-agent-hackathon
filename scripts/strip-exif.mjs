// Removes EXIF and other metadata (camera, time, GPS location) from images, in place.
//
//   npm run strip-exif                      every image in demo-assets/
//   npm run strip-exif -- photo.jpg dir/    the files and folders you name
//   npm run strip-exif -- --check           only report which images still carry metadata
//
// The picture is turned upright first (so a phone photo does not end up sideways) and then re-encoded with
// no metadata. JPEG and WebP stay in their own format; anything else is saved as PNG with the same name.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import sharp from "sharp";

const IMAGE = new Set([".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".heic", ".avif"]);
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const targets = args.filter((a) => !a.startsWith("--"));
if (!targets.length) targets.push("demo-assets");

function* files(path) {
  const st = statSync(path);
  if (st.isDirectory()) {
    for (const name of readdirSync(path)) yield* files(join(path, name));
  } else if (IMAGE.has(extname(path).toLowerCase())) {
    yield path;
  }
}

let seen = 0;
let dirty = 0;
for (const target of targets) {
  let list;
  try {
    list = [...files(target)];
  } catch {
    console.error(`Cannot read ${target}`);
    process.exitCode = 1;
    continue;
  }
  for (const file of list) {
    seen += 1;
    const meta = await sharp(readFileSync(file)).metadata();
    const hasMeta = !!(meta.exif || meta.xmp || meta.iptc);
    if (hasMeta) dirty += 1;
    if (checkOnly) {
      console.log(`${hasMeta ? "HAS METADATA" : "clean       "}  ${file}`);
      continue;
    }
    const ext = extname(file).toLowerCase();
    let img = sharp(readFileSync(file)).rotate(); // apply the orientation, then drop it with the rest
    img = ext === ".webp" ? img.webp({ quality: 90 }) : ext === ".jpg" || ext === ".jpeg" ? img.jpeg({ quality: 92 }) : img.png();
    writeFileSync(file, await img.toBuffer());
    console.log(`${hasMeta ? "stripped    " : "no metadata "}  ${file}`);
  }
}
console.log(`${seen} image${seen === 1 ? "" : "s"} checked${checkOnly ? `, ${dirty} with metadata` : `, ${dirty} had metadata, now removed`}.`);
if (checkOnly && dirty) process.exitCode = 1;
