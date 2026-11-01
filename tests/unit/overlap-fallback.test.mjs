// When type behind the product cannot keep the headline visible, the product visual falls back to the studio layout,
// says so, and a revision of that round stays on the studio layout.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

process.env.MODEL_API_KEY = 'test-fake-key';

const calls = [];
const flat = await sharp({ create: { width: 1080, height: 1080, channels: 3, background: '#335577' } }).png().toBuffer();
mock.module('../../src/lib/meta/design/layouts.ts', {
  namedExports: {
    OVERLAP_UNFIXABLE: 'OVERLAP_UNFIXABLE',
    renderDesign: async (spec) => {
      calls.push({ archetype: spec.archetype, overlapGuard: spec.overlapGuard });
      if (spec.archetype === 'behind') throw new Error('OVERLAP_UNFIXABLE');
      spec.onLayout?.({ mode: 'composite', zoom: 1, gapPx: 10, productGapPx: 10, textTop: 80, textBottom: 300, productTop: 330, productBottom: 900, productLeft: 200, productRight: 800, headSize: 150 });
      return flat;
    },
  },
});
const { buildProductVisual, OVERLAP_NOTE } = await import('../../src/lib/meta/visuals.ts');

const plan = { archetype: 'behind', artPrompt: '', headline: 'Low Stool', subline: '', badge: [], cta: 'Shop now', pattern: 'grid', variant: null, colours: [], ctaScale: 1, gapScale: 1, overlapGuard: 2 };
const brief = { briefType: 'product', clientName: 'Shop', productNoun: 'stool', audience: 'online shoppers' };
const cutout = { png: await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer(), box: { left: 0, top: 0, width: 100, height: 100 } };

test('a refused type-behind layout becomes the studio layout, with a plain note, and the guard level is passed on', async () => {
  const events = [];
  const visual = await buildProductVisual(plan, brief, 'paid_social_square', cutout, { async take() {} }, null, (e) => events.push(e));
  assert.deepEqual(calls.map((c) => c.archetype), ['behind', 'product']);
  assert.equal(calls[0].overlapGuard, 2, 'the tightened guard reaches the layout');
  assert.equal(visual.archetype, 'product');
  assert.equal(visual.method, 'layout composite');
  assert.ok(events.some((e) => e.type === 'fallback_note' && e.message === OVERLAP_NOTE));
  assert.match(OVERLAP_NOTE, /covered part of the headline, so the studio layout was used/);
  assert.ok(!/[–—]/.test(OVERLAP_NOTE));
});
