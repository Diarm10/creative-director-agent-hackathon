// The cut-out built from a SAM mask must be solid: no ghosting, no stray islands, no holes, and
// the alpha must line up with the shape (regression for the 3-channel alpha bug).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { buildCutout, largestComponent, fillHoles } from '../../src/lib/meta/cutoutMask.ts';

const MW = 100, MH = 120;
const IMG_W = 300, IMG_H = 360; // photo is 3x the mask

function maskWith(fn) {
  const r = new Uint8Array(MW * MH);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) r[y * MW + x] = fn(x, y) ? 1 : 0;
  return r;
}

async function photo() {
  return sharp({ create: { width: IMG_W, height: IMG_H, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer();
}

async function alphaOf(png) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const a = new Uint8Array(info.width * info.height);
  for (let i = 0; i < a.length; i++) a[i] = data[i * info.channels + 3];
  return { a, w: info.width, h: info.height };
}

test('largestComponent drops stray islands and fillHoles closes interior holes', () => {
  const r = maskWith((x, y) => (x >= 20 && x < 80 && y >= 20 && y < 100 && !(x >= 40 && x < 50 && y >= 40 && y < 50)) || (x >= 2 && x < 6 && y >= 2 && y < 6));
  const main = largestComponent(r, MW, MH);
  assert.equal(main[3 * MW + 3], 0, 'island removed');
  assert.equal(main[30 * MW + 30], 1);
  const filled = fillHoles(main, MW, MH);
  assert.equal(filled[45 * MW + 45], 1, 'hole filled');
  assert.equal(filled[10 * MW + 10], 0, 'outside stays empty');
});

test('buildCutout is solid inside, empty outside, and trimmed to the shape', async () => {
  const raster = maskWith((x, y) => (x >= 20 && x < 80 && y >= 20 && y < 100) || (x >= 2 && x < 6 && y >= 2 && y < 6));
  const out = await buildCutout({
    photoPng: await photo(), raster, maskW: MW, maskH: MH,
    bounds: { left: 0, top: 0, right: IMG_W, bottom: IMG_H }, imgW: IMG_W, imgH: IMG_H,
  });
  assert.ok(out);
  const { a, w, h } = await alphaOf(out.png);
  // The 60x80 mask rectangle is 180x240 in the photo; the island must not widen the crop.
  assert.ok(Math.abs(w - 180) <= 4, `width ${w}`);
  assert.ok(Math.abs(h - 240) <= 4, `height ${h}`);
  assert.equal(out.box.width, w);

  let solid = 0, partial = 0, empty = 0;
  const inset = 4;
  for (let y = inset; y < h - inset; y++) {
    for (let x = inset; x < w - inset; x++) {
      const v = a[y * w + x];
      if (v === 255) solid++; else if (v === 0) empty++; else partial++;
    }
  }
  assert.equal(empty, 0, 'no transparent pixels inside the product');
  assert.equal(partial, 0, 'no semi-transparent pixels inside the product');
  assert.ok(solid > 0);
  // Only a thin edge ring may be partial.
  const total = (w - 8) * (h - 8);
  assert.equal(solid, total);
});

test('buildCutout keeps colour pixels from the photo and fills an interior hole', async () => {
  const raster = maskWith((x, y) => x >= 20 && x < 80 && y >= 20 && y < 100 && !(x >= 40 && x < 55 && y >= 50 && y < 70));
  const out = await buildCutout({
    photoPng: await photo(), raster, maskW: MW, maskH: MH,
    bounds: { left: 0, top: 0, right: IMG_W, bottom: IMG_H }, imgW: IMG_W, imgH: IMG_H,
  });
  const { a, w, h } = await alphaOf(out.png);
  assert.equal(a[Math.floor(h / 2) * w + Math.floor(w / 2)], 255, 'hole in the middle is solid');
  const { data, info } = await sharp(out.png).raw().toBuffer({ resolveWithObject: true });
  const mid = (Math.floor(h / 2) * w + Math.floor(w / 2)) * info.channels;
  assert.deepEqual([data[mid], data[mid + 1], data[mid + 2]], [200, 40, 40]);
});

test('buildCutout returns null for an empty mask', async () => {
  const out = await buildCutout({
    photoPng: await photo(), raster: new Uint8Array(MW * MH), maskW: MW, maskH: MH,
    bounds: { left: 0, top: 0, right: IMG_W, bottom: IMG_H }, imgW: IMG_W, imgH: IMG_H,
  });
  assert.equal(out, null);
});

test('a large enclosed opening, like a mug handle, stays open; a small hole is still filled', () => {
  const w = 40;
  const h = 40;
  const r = new Uint8Array(w * h).fill(1);
  const hole = (x0, y0, x1, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) r[y * w + x] = 0; };
  hole(5, 5, 8, 8); // 9 pixels: a highlight
  hole(15, 10, 31, 30); // 320 pixels: a handle opening, 20 percent of the mask
  const filled = fillHoles(r, w, h);
  assert.equal(filled[6 * w + 6], 1);
  assert.equal(filled[20 * w + 20], 1, 'by default every enclosed hole is filled');
  const selective = fillHoles(r, w, h, 0.035);
  assert.equal(selective[6 * w + 6], 1, 'the small hole is filled');
  assert.equal(selective[20 * w + 20], 0, 'the large opening stays open');
});

test('a mug handle opening is fully see-through: a thin sliver of background hanging across it is opened away, the handle stays', async () => {
  const BODY = (x, y) => x >= 40 && x < 90 && y >= 20 && y < 100;
  const RING = (x, y) => x >= 10 && x < 44 && y >= 40 && y < 80 && !(x >= 22 && x < 40 && y >= 48 && y < 72);
  const SLIVER = (x, y) => x >= 22 && x < 40 && y === 60; // one mask pixel thick, across the opening
  const r = maskWith((x, y) => BODY(x, y) || RING(x, y) || SLIVER(x, y));
  const cut = await buildCutout({ photoPng: await photo(), raster: r, maskW: MW, maskH: MH, bounds: { left: 0, top: 0, right: IMG_W, bottom: IMG_H }, imgW: IMG_W, imgH: IMG_H });
  const { a, w } = await alphaOf(cut.png);
  const at = (mx, my) => a[(my * 3 - cut.box.top) * w + (mx * 3 - cut.box.left)];
  assert.equal(at(30, 60), 0, 'the middle of the opening, on the sliver, is transparent');
  assert.equal(at(30, 52), 0, 'and so is the rest of the opening');
  assert.equal(at(30, 72 + 3), 255, 'the handle below the opening is solid');
  assert.equal(at(14, 60), 255, 'the handle on the left is solid');
  assert.equal(at(60, 60), 255, 'the body is solid');
});
