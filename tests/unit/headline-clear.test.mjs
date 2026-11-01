// A two-line headline over a tall product (a tote with handles, the notebook): the product starts below the last line with a gap of at least
// 3 percent of the frame height, in every Look that puts a product under a headline, and no product pixel is inside the headline box.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { restyle } from '../../src/lib/meta/restyle.ts';
import { LOOKS } from '../../src/lib/meta/looks.ts';
import { MIN_HEADLINE_GAP, MIN_PRODUCT_SHARE } from '../../src/lib/meta/design/layouts.ts';

const H = 1080;
// A tote drawn as a cut-out: a body, and two thin handle loops above it (the part that used to run into the second line).
const tote = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="760"><rect x="40" y="220" width="560" height="520" fill="#c9a56a"/><path d="M170 230 C170 20 250 20 250 230 M390 230 C390 20 470 20 470 230" stroke="#777" stroke-width="22" fill="none"/></svg>')).png().toBuffer();
const cuts = { tote, notebook: readFileSync(new URL('./fixtures/notebook-black-cutout.png', import.meta.url)) };

async function measure(cut, layout) {
  const w = layout.productRight - layout.productLeft;
  const h = layout.productBottom - layout.productTop;
  const a = await sharp(cut).resize(w, h, { fit: 'fill' }).ensureAlpha().extractChannel(3).raw().toBuffer();
  const b = layout.headlineBounds;
  let firstRow = h;
  let inBox = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (a[y * w + x] <= 40) continue;
      if (y < firstRow) firstRow = y;
      const px = layout.productLeft + x;
      const py = layout.productTop + y;
      if (px >= b.left && px <= b.right && py >= b.top && py <= b.bottom) inBox++;
    }
  }
  return { gap: layout.productTop + firstRow - b.bottom, inBox, share: h / H };
}

for (const [name, cut] of Object.entries(cuts)) {
  for (const theme of ['christmas', 'halloween', 'dayofthedead']) {
    test(`${name}, ${theme}: a two-line headline is never touched by the product, in every Look`, async () => {
      for (const l of LOOKS) {
        for (const archetype of l.layouts.filter((a) => a === 'behind' || a === 'product')) {
          // A magazine masthead keeps a small overlap on purpose, so the masthead on the type-behind layout is the one exception.
          if (l.id === 'magazine' && archetype === 'behind') continue;
          const r = await restyle({ archetype, plan: { headline: 'Bring Home Joy', subline: '', cta: 'Shop now', badge: [], ctaScale: 1, gapScale: 1, overlapGuard: 0, productScale: 1, headScale: 1, colours: [] }, brief: { clientName: 'Fernhill Home', look: l.id, theme, facts: '' }, cutoutPng: cut, effect: undefined });
          const m = await measure(cut, r.layout);
          const tag = `${l.id} on ${archetype}`;
          assert.equal(m.inBox, 0, `${tag}: ${m.inBox} product pixels are inside the headline box`);
          assert.ok(m.gap >= Math.floor(MIN_HEADLINE_GAP * H * 0.97), `${tag}: the gap below the last line is ${m.gap} px, under 3 percent of the height`);
          assert.ok(m.share >= MIN_PRODUCT_SHARE - 0.005, `${tag}: the product is only ${(m.share * 100).toFixed(0)} percent of the frame height`);
        }
      }
    });
  }
}

test('a gap setting that would close the gap cannot bring the product within 3 percent of the headline', async () => {
  const r = await restyle({ archetype: 'product', plan: { headline: 'Bring Home Joy', subline: '', cta: 'Shop now', badge: [], ctaScale: 1, gapScale: 0.4, overlapGuard: 0, productScale: 1, headScale: 1, colours: [] }, brief: { clientName: 'Fernhill Home', look: 'loud', theme: 'christmas', facts: '' }, cutoutPng: cuts.tote, effect: undefined });
  const m = await measure(cuts.tote, r.layout);
  assert.ok(m.gap >= Math.floor(MIN_HEADLINE_GAP * H * 0.97), `gap ${m.gap}`);
});
