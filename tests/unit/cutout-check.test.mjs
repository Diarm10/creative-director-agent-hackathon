// The cut-out check and the studio-first fallback: type behind the product is the first direction unless the cut-out is not clean.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { cutoutWorks } from '../../src/lib/meta/cutoutCheck.ts';
import { directionForRound } from '../../src/lib/meta/directions.ts';

// A cut-out PNG of w by h: fully solid, or only a scatter of dots.
async function cutout(w, h, kind = 'solid') {
  const raw = Buffer.alloc(w * h * 4, 0);
  const fill = (x, y) => {
    const i = (y * w + x) * 4;
    raw[i] = 200; raw[i + 1] = 100; raw[i + 2] = 50; raw[i + 3] = 255;
  };
  const step = kind === 'dots' ? 8 : 1;
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) fill(x, y);
  return sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

test('a solid product that is a sensible part of the photo works', async () => {
  const v = await cutoutWorks(await cutout(500, 700), 1280, 1920);
  assert.equal(v.works, true);
  assert.equal(v.reason, null);
});

test('a tiny cut-out, a cut-out of the whole photo and a scatter of dots all fail with a plain reason', async () => {
  const tiny = await cutoutWorks(await cutout(60, 60), 1280, 1920);
  assert.equal(tiny.works, false);
  assert.match(tiny.reason, /small part of the photo/);
  const whole = await cutoutWorks(await cutout(1280, 1280), 1280, 1280);
  assert.equal(whole.works, false);
  assert.match(whole.reason, /almost the whole photo/);
  const dots = await cutoutWorks(await cutout(400, 400, 'dots'), 1280, 1280);
  assert.equal(dots.works, false);
  assert.match(dots.reason, /gaps and loose pieces/);
});

test('the photo size is scaled the way the cut-out was: a big photo is compared at 1280 on the long side', async () => {
  assert.equal((await cutoutWorks(await cutout(600, 800), 3000, 4000)).works, true);
});

test('a product ad starts with type behind the product, and falls back to the studio shot when the cut-out is not clean', () => {
  assert.equal(directionForRound('product', 1).id, 'type-behind');
  assert.equal(directionForRound('product', 1, { behindOk: true }).id, 'type-behind');
  assert.equal(directionForRound('product', 1, { behindOk: false }).id, 'studio');
  assert.equal(directionForRound('product', 2, { behindOk: false }).id, 'scene');
  assert.equal(directionForRound('product', 3, { behindOk: false }), null);
  assert.equal(directionForRound('event', 1, { behindOk: false }).id, 'colour-block');
});
