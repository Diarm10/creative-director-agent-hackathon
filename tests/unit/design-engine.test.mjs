// The layout engine draws every archetype at exactly the requested size, fits headlines inside
// their box, and builds sane palettes. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { renderDesign, productLuminance } from '../../src/lib/meta/design/layouts.ts';
import { makePalette, contrast, normaliseHex } from '../../src/lib/meta/design/palette.ts';
import { fitHeadline, measure100 } from '../../src/lib/meta/design/typeset.ts';
import { patternSvg, rng } from '../../src/lib/meta/design/patterns.ts';

const solid = (w, h, c) => sharp({ create: { width: w, height: h, channels: 3, background: c } }).png().toBuffer();
const cutout = () =>
  sharp({ create: { width: 200, height: 260, channels: 4, background: { r: 30, g: 30, b: 30, alpha: 1 } } }).png().toBuffer();

const COPY = {
  organiser: 'Dublin Builders Meetup',
  headline: 'Build for Your World',
  subline: 'An evening of demos and talks.',
  details: ['Thu 20 Nov, 7pm', 'The Dock, Dublin'],
  cta: 'Free entry. RSVP online',
};

for (const [w, h] of [[1080, 1080], [1080, 1920], [1200, 1800]]) {
  test(`typographic renders at ${w}x${h}`, async () => {
    const png = await renderDesign({ archetype: 'typographic', width: w, height: h, badge: ['Free', 'entry'], ...COPY });
    const m = await sharp(png).metadata();
    assert.equal(m.width, w);
    assert.equal(m.height, h);
  });
}

test('artwork layout renders at the requested size and covers the artwork', async () => {
  const png = await renderDesign({ archetype: 'artwork', width: 1080, height: 1080, artwork: await solid(900, 600, '#c0392b'), ...COPY });
  const m = await sharp(png).metadata();
  assert.deepEqual([m.width, m.height], [1080, 1080]);
  // The top of the canvas is the artwork colour, the bottom is the flat panel.
  const { data } = await sharp(png).extract({ left: 540, top: 20, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[0] > 120, 'artwork shows at the top');
});

test('product layout renders at the requested size and needs a cut-out', async () => {
  const png = await renderDesign({ archetype: 'product', width: 1080, height: 1920, product: await cutout(), ...COPY });
  const m = await sharp(png).metadata();
  assert.deepEqual([m.width, m.height], [1080, 1920]);
  await assert.rejects(renderDesign({ archetype: 'product', width: 1080, height: 1080, ...COPY }), /cut-out/);
});

test('a dark product is judged dark, so the layout picks a light block', async () => {
  assert.ok((await productLuminance(await cutout())) < 0.38);
});

test('fitHeadline keeps every line inside the box and avoids tiny type', async () => {
  const maxWidth = 900;
  const fit = await fitHeadline({ text: 'Build for Your World', maxWidth, maxHeight: 700, maxLines: 3, lineHeight: 0.92, maxSize: 460 });
  assert.ok(fit.lines.length >= 1 && fit.lines.length <= 3);
  assert.equal(fit.lines.join(' '), 'Build for Your World');
  for (const line of fit.lines) {
    const w = ((await measure100(line, 'display', true, 0.01)) * fit.size) / 100;
    assert.ok(w <= maxWidth + 2, `"${line}" is ${w}px wide`);
  }
  assert.ok(fit.size > 150, `size ${fit.size}`);
  assert.ok(fit.lines.length * fit.size * 0.92 <= 700 + 1);
});

test('a single long word shrinks to fit instead of overflowing', async () => {
  const fit = await fitHeadline({ text: 'Internationalisation', maxWidth: 600, maxHeight: 700, maxLines: 2, lineHeight: 0.92, maxSize: 460 });
  const w = ((await measure100('Internationalisation', 'display', true, 0.01)) * fit.size) / 100;
  assert.ok(w <= 602);
});

test('palette: invalid colours are ignored, folio colours are kept, contrast is readable', () => {
  assert.equal(normaliseHex('navy'), null);
  assert.equal(normaliseHex('#abc'), '#AABBCC');
  const sparks = makePalette(['#1A7F64', '#F4F1EA', '#111111']);
  assert.equal(sparks.dark, '#111111');
  assert.equal(sparks.light, '#F4F1EA');
  assert.equal(sparks.accents[0], '#1A7F64');
  assert.ok(contrast(sparks.dark, sparks.light) > 7);
  const none = makePalette(['navy and gold']);
  assert.ok(contrast(none.dark, none.light) > 7);
  const oneColour = makePalette(['#2F6F8F']);
  assert.ok(contrast(oneColour.dark, oneColour.light) >= 4.5);
});

test('patterns are deterministic per seed and differ between seeds', () => {
  const p = makePalette(undefined);
  assert.equal(patternSvg('diagonals', 400, 400, p, true, 5), patternSvg('diagonals', 400, 400, p, true, 5));
  assert.notEqual(patternSvg('diagonals', 400, 400, p, true, 5), patternSvg('diagonals', 400, 400, p, true, 6));
  assert.equal(rng(1)(), rng(1)());
  for (const kind of ['diagonals', 'grid', 'arcs']) assert.match(patternSvg(kind, 300, 300, p, true, 2), /^<svg/);
});

test('summed word widths match a direct measurement of the whole line', async () => {
  const { lineWidth100 } = await import('../../src/lib/meta/design/typeset.ts');
  for (const line of ['Build for', 'Your World', 'Thirty hours in your pocket']) {
    const direct = await measure100(line, 'display', true, 0.01);
    const summed = await lineWidth100(line, 'display', true, 0.01);
    assert.ok(Math.abs(direct - summed) / direct < 0.06, `${line}: direct ${direct} vs summed ${summed}`);
  }
});

test('a brand with one accent keeps it for both slots instead of inventing a blue', async () => {
  const { legibleAccent } = await import('../../src/lib/meta/design/palette.ts');
  const p = makePalette(['#1A7F64', '#F4F1EA', '#111111']);
  assert.deepEqual(p.accents, ['#1A7F64', '#1A7F64']);
  // Whatever it picks must be readable on the background it is used on.
  for (const bg of ['#111111', '#F4F1EA']) assert.ok(contrast(legibleAccent(bg, p), bg) >= 4.5, bg);
  // Green on near-black is too dim for small text, so it falls back to the light text colour there.
  assert.equal(legibleAccent('#111111', p), p.light);
});
