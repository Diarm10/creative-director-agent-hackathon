// Small type that would be hard to read on an effect background is switched to white or black on a soft backing, by the layout engine only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { legibleSmallType, LEGIBLE_RATIO } from '../../src/lib/meta/design/layouts.ts';
import { contrast } from '../../src/lib/meta/design/palette.ts';
import { restyle } from '../../src/lib/meta/restyle.ts';

const flat = (hex) => sharp({ create: { width: 1080, height: 1080, channels: 3, background: hex } }).png().toBuffer();
const block = (color, extra = {}) => ({ text: 'Warmth for Christmas morning', x: 60, y: 900, width: 700, size: 32, font: 'body', color, ...extra });

test('small type on a background too close to its colour is switched to a readable colour with a backing', async () => {
  const blocks = [block('#7A4B45')];
  const shapes = await legibleSmallType(await flat('#B9736C'), blocks, 1080, 1080);
  assert.equal(shapes.length, 1, 'one backing');
  assert.match(shapes[0], /<rect /);
  assert.ok(['#FFFFFF', '#111111'].includes(blocks[0].color), blocks[0].color);
  assert.ok(contrast(blocks[0].color, '#B9736C') >= 3, 'the new colour reads on the field');
});

test('type that already reads is left alone', async () => {
  const blocks = [block('#102A1E')];
  const shapes = await legibleSmallType(await flat('#F3EBDD'), blocks, 1080, 1080);
  assert.deepEqual(shapes, []);
  assert.equal(blocks[0].color, '#102A1E');
});

test('dark type on a dark field is switched to white, light type on a light field to near black', async () => {
  const dark = [block('#2B2B2B')];
  await legibleSmallType(await flat('#2F3A33'), dark, 1080, 1080);
  assert.equal(dark[0].color, '#FFFFFF');
  const light = [block('#F0F0F0')];
  await legibleSmallType(await flat('#E8E2D6'), light, 1080, 1080);
  assert.equal(light[0].color, '#111111');
});

test('only small lines are looked at: a headline-size block and a button label are left alone', async () => {
  const blocks = [block('#B9736C', { font: 'display', size: 120 }), block('#B9736C', { font: 'body-bold', size: 30 })];
  const shapes = await legibleSmallType(await flat('#B9736C'), blocks, 1080, 1080);
  assert.deepEqual(shapes, []);
});

test('a worst-case fifth of busy pixels is enough: dots that swallow the text colour trigger the switch', async () => {
  const w = 1080;
  const raw = Buffer.alloc(w * 1080 * 3, 0xe8);
  for (let y = 880; y < 960; y += 8) for (let x = 40; x < 800; x += 8) for (let dy = 0; dy < 5; dy++) for (let dx = 0; dx < 5; dx++) { const i = ((y + dy) * w + x + dx) * 3; raw[i] = 0x2a; raw[i + 1] = 0x44; raw[i + 2] = 0x34; }
  const pic = await sharp(raw, { raw: { width: w, height: 1080, channels: 3 } }).png().toBuffer();
  const blocks = [block('#2A4434')];
  const shapes = await legibleSmallType(pic, blocks, w, 1080);
  assert.equal(shapes.length, 1);
});

const cut = (n) => readFileSync(new URL(`./fixtures/${n}-cutout.png`, import.meta.url));
for (const effect of ['duotone', 'popart']) {
  test(`${effect}: the subline of a real render has a readable colour against what is under it`, async () => {
    const r = await restyle({ archetype: 'behind', plan: { headline: 'Grow Together', subline: 'Warmth for Christmas morning', cta: 'Shop gifts', badge: [], ctaScale: 1, gapScale: 1, overlapGuard: 0, productScale: 1, headScale: 1, colours: [] }, brief: { clientName: 'Fernhill Home', look: 'loud', theme: 'christmas', facts: 'A plant' }, cutoutPng: cut('plant-snake'), effect: { id: effect, intensity: 70, stylise: false } });
    // The subline sits at the bottom left: measure the strip it is drawn on.
    const strip = await sharp(r.png).extract({ left: 40, top: 930, width: 420, height: 34 }).removeAlpha().raw().toBuffer();
    const lum = (rr, g, b) => { const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(rr) + 0.7152 * f(g) + 0.0722 * f(b); };
    // The text is the brightest or darkest thing in the strip; the backing and the field are the rest. Both extremes must be far apart.
    let lo = 1, hi = 0;
    for (let i = 0; i < strip.length; i += 3) { const l = lum(strip[i], strip[i + 1], strip[i + 2]); lo = Math.min(lo, l); hi = Math.max(hi, l); }
    assert.ok((hi + 0.05) / (lo + 0.05) >= LEGIBLE_RATIO, `${effect}: strip contrast ${((hi + 0.05) / (lo + 0.05)).toFixed(1)}`);
  });
}

test('Duotone is visibly different from the Look\'s own background on every Look', async () => {
  const { LOOKS } = await import('../../src/lib/meta/looks.ts');
  const mad = async (a, b) => { const x = await sharp(a).resize(128, 128).removeAlpha().raw().toBuffer(); const y = await sharp(b).resize(128, 128).removeAlpha().raw().toBuffer(); let d = 0; for (let i = 0; i < x.length; i++) d += Math.abs(x[i] - y[i]); return d / x.length; };
  for (const theme of ['evergreen', 'christmas']) {
    for (const l of LOOKS) {
      const archetype = l.layouts[0] === 'behind' ? 'behind' : 'product';
      const go = (effect) => restyle({ archetype, plan: { headline: 'Sit Anywhere', subline: '', cta: 'Shop now', badge: [], ctaScale: 1, gapScale: 1, overlapGuard: 0, productScale: 1, headScale: 1, colours: [] }, brief: { clientName: 'Fernhill Home', look: l.id, theme, facts: '' }, cutoutPng: cut('stool-wooden'), effect });
      const own = await go(undefined);
      const duo = await go({ id: 'duotone', intensity: 70, stylise: false });
      const d = await mad(own.png, duo.png);
      assert.ok(d >= 12, `${l.id} on ${theme}: duotone differs from the Look's own by only ${d.toFixed(1)}`);
    }
  }
});
