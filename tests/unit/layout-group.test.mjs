// Type and product as one group on a product scene: no dead band between them, the product is never cropped,
// the group is centred, and a spacing note changes the composition by a clear step. The scene is synthetic (a
// calm wall, a textured surface, a product-like block), so the test needs no model call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDesign, groupParams, mapSceneBox } from '../../src/lib/meta/design/layouts.ts';
import { makePalette } from '../../src/lib/meta/design/palette.ts';
import { inferSpacingChange } from '../../src/lib/meta/revision.ts';
import { makeScene } from './_scene.mjs';

const palette = makePalette(['#1A7F64', '#F4F1EA', '#111111']);
const copy = { headline: 'Fits in a jeans pocket', subline: 'Up to 24 hours of listening with the case', organiser: 'Sparks Audio', details: [], cta: 'Learn more', badge: [] };
const FORMATS = [
  { name: 'square', W: 1080, H: 1080, size: 1024, height: 1024, G: 44 },
  { name: 'story', W: 1080, H: 1920, size: 1024, height: 1792, G: 64 },
  { name: 'poster', W: 1200, H: 1800, size: 1024, height: 1536, G: 52 * 1.1111 },
];

async function layoutOf(fm, extra = {}, sceneOpts = {}) {
  const { scene, productBox } = await makeScene({ size: fm.size, height: fm.height, ...sceneOpts });
  let metrics = null;
  const image = await renderDesign({ archetype: 'artwork', width: fm.W, height: fm.H, palette, artwork: scene, keepWhole: true, productBox, ...copy, ...extra, onLayout: (m) => (metrics = m) });
  return { metrics, image, scene, productBox };
}

for (const fm of FORMATS) {
  test(`${fm.name}: the type sits on the product with a deliberate margin, the product stays whole, and the group is centred`, async () => {
    const { metrics: m } = await layoutOf(fm);
    assert.equal(m.mode, 'grouped');
    assert.ok(Math.abs(m.productGapPx - fm.G) <= 2, `gap ${m.productGapPx} is the deliberate margin ${fm.G}`);
    assert.ok(m.productGapPx <= 0.07 * fm.H, 'no dead band');
    assert.ok(m.productTop > m.textBottom, 'the type never covers the product');
    assert.ok(m.productLeft >= 0 && m.productRight <= fm.W, 'the product is not cropped at the sides');
    assert.ok(m.productTop >= 0 && m.productBottom <= fm.H, 'nor at the top or bottom');
    assert.ok(m.zoom >= 1 && m.zoom <= 1.6, 'the scene is only enlarged, within limits');
    const above = m.textTop;
    const below = fm.H - m.productBottom;
    assert.ok(Math.abs(above - below) <= 0.04 * fm.H, `centred: ${above} above, ${below} below`);
  });
}

test('the gap is far smaller than before: a wide gap in the plain scene becomes the deliberate margin', async () => {
  // In this scene the product top sits 0.13 of the height below where the surface starts, and the old layout put
  // the type in the calm top, so the type-to-product distance was the old calm zone minus the type: well over 200 px.
  const fm = FORMATS[0];
  const { metrics: m, productBox } = await layoutOf(fm);
  const oldDistance = productBox.top * (fm.H / fm.height) - 372; // the old engine ended its type at about 372 px here
  assert.ok(oldDistance > 200, `before: ${Math.round(oldDistance)} px`);
  assert.ok(m.productGapPx < oldDistance / 4, `after: ${m.productGapPx} px`);
});

test('a spacing note changes the composition by a clear step: the gap, the headline and the product all move', async () => {
  for (const fm of FORMATS.slice(0, 2)) {
    const base = (await layoutOf(fm)).metrics;
    const tight = (await layoutOf(fm, { gapScale: 1 / 1.6 })).metrics;
    const loose = (await layoutOf(fm, { gapScale: 1.6 })).metrics;
    assert.ok(base.productGapPx - tight.productGapPx >= 15, `${fm.name} tighter: ${base.productGapPx} to ${tight.productGapPx}`);
    assert.ok(loose.productGapPx - base.productGapPx >= 25, `${fm.name} looser: ${base.productGapPx} to ${loose.productGapPx}`);
    const moved = Math.abs(tight.productTop - base.productTop) + Math.abs(tight.headSize - base.headSize);
    assert.ok(moved >= 20, `${fm.name}: the product or the headline moved by ${moved}`);
    assert.ok(Math.abs(loose.productTop - base.productTop) >= 20, `${fm.name}: a looser layout moves the product`);
    assert.ok(tight.productGapPx < base.productGapPx && base.productGapPx < loose.productGapPx);
    for (const m of [base, tight, loose]) assert.ok(m.keptLabel && m.keptSubline, `${fm.name}: a spacing change never drops the label or the subline`);
  }
});

test('a textured surface between the wall and the product is not mistaken for a calm wall', async () => {
  const { metrics } = await layoutOf(FORMATS[0], {}, { wallEnd: 0.4, product: { left: 0.3, top: 0.6, right: 0.7, bottom: 0.88 } });
  assert.equal(metrics.mode, 'grouped');
  assert.ok(metrics.productGapPx <= 50, `the type is anchored to the product, not to the wall edge: ${metrics.productGapPx}`);
  assert.ok(metrics.textBottom < metrics.productTop);
});

test('with no product box from SAM the layout still groups the type with the scene, and fails safe', async () => {
  const fm = FORMATS[0];
  const { scene } = await makeScene({});
  let m = null;
  await renderDesign({ archetype: 'artwork', width: fm.W, height: fm.H, palette, artwork: scene, keepWhole: true, ...copy, onLayout: (x) => (m = x) });
  assert.equal(m.mode, 'grouped');
  assert.ok(m.textBottom < m.productTop);
});

test('a scene with no calm space for type is still refused for a real product, never covered or smeared', async () => {
  const fm = FORMATS[0];
  const { scene, productBox } = await makeScene({ wallEnd: 0.02, product: { left: 0.3, top: 0.1, right: 0.7, bottom: 0.5 } });
  await assert.rejects(renderDesign({ archetype: 'artwork', width: fm.W, height: fm.H, palette, artwork: scene, keepWhole: true, productBox, ...copy }), /NO_CALM_SPACE/);
});

test('the clean composite also groups the type and the product, with spare height split above and below', async () => {
  const sharp = (await import('sharp')).default;
  const product = await sharp({ create: { width: 800, height: 300, channels: 4, background: { r: 60, g: 100, b: 130, alpha: 1 } } }).png().toBuffer();
  let m = null;
  await renderDesign({ archetype: 'product', width: 1080, height: 1080, palette, product, ...copy, onLayout: (x) => (m = x) });
  assert.equal(m.mode, 'composite');
  assert.ok(m.productTop - m.textBottom <= 60, `gap ${m.productTop - m.textBottom}`);
  assert.ok(m.textTop > 72, 'spare height moved the group down instead of leaving a band under the type');
});

test('the box SAM finds in the scene is mapped onto the cover-fitted canvas', () => {
  assert.deepEqual(mapSceneBox({ left: 100, top: 200, width: 300, height: 400 }, 1000, 1000, 1000, 1000), { left: 100, top: 200, right: 400, bottom: 600 });
  const wide = mapSceneBox({ left: 0, top: 0, width: 2000, height: 1000 }, 2000, 1000, 1000, 1000);
  assert.equal(wide.top, 0);
  assert.equal(wide.bottom, 1000);
  assert.ok(wide.left >= 0 && wide.right <= 1000);
});

test('each format has its own margin and zoom limit', () => {
  const sq = groupParams(1080, 1080, 1, 72, { top: 72, bottom: 72 });
  const st = groupParams(1080, 1920, 1, 72, { top: 150, bottom: 150 });
  const po = groupParams(1200, 1800, 1.11, 80, { top: 80, bottom: 80 });
  assert.deepEqual([sq.format, st.format, po.format], ['square', 'story', 'poster']);
  assert.ok(st.G0 > sq.G0 && po.G0 > sq.G0);
  assert.ok(st.sMax < sq.sMax, 'the tall format enlarges the scene less');
});

test('inferSpacingChange reads a note about the gap in either direction, and prefers the person to the critic', () => {
  const none = { note: '', weakness: '', fix: '' };
  assert.equal(inferSpacingChange({ ...none, note: 'The gap between the text and the button is too big.' }), 'smaller');
  assert.equal(inferSpacingChange({ ...none, note: 'Tighten the spacing and bring the product closer.' }), 'smaller');
  assert.equal(inferSpacingChange({ ...none, note: 'There is a dead band between the headline and the product' }), 'smaller');
  assert.equal(inferSpacingChange({ ...none, note: 'It feels cramped, add some breathing room.' }), 'larger');
  assert.equal(inferSpacingChange({ ...none, note: 'The gap is too tight.' }), 'larger');
  assert.equal(inferSpacingChange({ ...none, note: 'Make the button bigger.' }), 'same');
  assert.equal(inferSpacingChange({ note: '', weakness: 'Large empty band between the text and the product', fix: 'Move the product closer to the headline' }), 'smaller');
  assert.equal(inferSpacingChange({ note: 'The gap is too tight', weakness: 'Large empty gap', fix: '' }), 'larger', 'the person comes first');
  assert.equal(inferSpacingChange(none), 'same');
});

test('a header panel never leaves a thin stripe of wall above it, and it ends above the product', async () => {
  for (const fm of FORMATS) {
    for (const wallEnd of [0.3, 0.38, 0.45]) {
      const { metrics: m } = await layoutOf(fm, {}, { wallEnd, product: { left: 0.3, top: 0.66, right: 0.7, bottom: 0.9 } });
      if (!m.panel) continue;
      assert.ok(m.panel.top === 0 || m.panel.top >= 40, `${fm.name} wall ${wallEnd}: panel starts at ${m.panel.top}`);
      assert.ok(m.panel.bottom < m.productTop && m.panel.bottom > m.textBottom, `${fm.name}: the panel holds the type and stops above the product`);
    }
  }
});

test('a shaded wall with dark edges is still wall: no header panel, so no seam', async () => {
  // A long, shaded wall all the way down to the product, like a generated scene: nothing here is a different surface.
  const fm = FORMATS[0];
  const { scene, productBox } = await makeScene({ wallEnd: 0.92, vignette: true, product: { left: 0.3, top: 0.5, right: 0.7, bottom: 0.88 } });
  let m = null;
  await renderDesign({ archetype: 'artwork', width: fm.W, height: fm.H, palette, artwork: scene, keepWhole: true, productBox, ...copy, onLayout: (x) => (m = x) });
  assert.ok(m, 'a layout was produced');
  assert.equal(m.panel, undefined, 'no panel on a plain shaded wall');
  assert.ok(m.textBottom < m.productTop);
});

test('the colour block never uses the bars pattern, which poked stubs over its edge: it is drawn with the grid instead', async () => {
  const base = { archetype: 'typographic', width: 1080, height: 1080, palette, seed: 4, variant: 'block', ...copy };
  const bars = await renderDesign({ ...base, pattern: 'bars' });
  const grid = await renderDesign({ ...base, pattern: 'grid' });
  assert.deepEqual(bars, grid);
});
