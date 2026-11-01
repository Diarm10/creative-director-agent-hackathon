// The fixes from a real run of the live app: gift headlines use the product noun alone, a whole photo is drawn large, effect
// shapes keep out of text boxes, the Approved group, a card that is being worked on, the round counter per ad, and the export message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { feedbackFile } from '../../src/lib/meta/feedbackExport.ts';
import { renderDesign } from '../../src/lib/meta/design/layouts.ts';
import { applyBackgroundEffect } from '../../src/lib/meta/design/effects.ts';
import { makePalette } from '../../src/lib/meta/design/palette.ts';
import { GROUP_LABEL, adRound, groupOf, isWorking, resultRows } from '../../src/lib/catalogue/model.ts';
import { progressLine } from '../../src/lib/catalogue/client.ts';
import { startRevision, initialRunState } from '../../src/components/creative-director/runState.ts';

// ---- 8. a whole photo is drawn large ----------------------------------------------------------------

const PAL = makePalette(['#1A1D21', '#F4F1EA', '#9AA7B2', '#6F7C88']);
const photo = (w, h) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 200, g: 190, b: 170, alpha: 1 } } }).png().toBuffer();
const draw = async (png, extra = {}) => {
  let layout;
  await renderDesign({ archetype: 'product', width: 1080, height: 1080, palette: PAL, product: png, organiser: 'Fernhill Home', headline: 'Pilea Plant in White Pot', subline: 'A plant with round green leaves', cta: 'Shop now', finish: 0, onLayout: (l) => (layout = l), ...extra });
  return layout;
};

test('the whole original photo fills at least 60 percent of the ad height when that does not clip it, and the button stays clear', async () => {
  const portrait = await photo(800, 1200); // 2 to 3, like a phone photo
  const small = await draw(portrait);
  const big = await draw(portrait, { photoPanel: true });
  const h = (l) => (l.productBottom - l.productTop) / 1080;
  assert.ok(h(small) < h(big), `without the panel rule the photo was a smaller tile: ${h(small)}`);
  assert.ok(h(big) >= 0.6, `the whole photo is ${Math.round(h(big) * 100)} percent of the ad height`);
  assert.ok(big.productBottom <= 1080, 'not clipped by the frame');
  assert.ok(big.productLeft >= 72 + 150, 'it stays right of the call to action button');
  const landscape = await draw(await photo(1500, 1000), { photoPanel: true });
  assert.ok(landscape.productRight - landscape.productLeft <= 1027 && landscape.productLeft >= 0, 'a wide photo is limited by the width, not clipped');
});

// ---- 9. effect shapes keep out of the text boxes ---------------------------------------------------------

test('Pop Art burst and dots never run under a text box: the plain background is kept there', async () => {
  const ground = await sharp({ create: { width: 600, height: 600, channels: 3, background: '#556677' } }).png().toBuffer();
  const colours = { dark: PAL.dark, light: PAL.light, accent: PAL.accents[0], accent2: PAL.accents[1] };
  const anchor = { cx: 300, cy: 330, r: 120 };
  const spec = { id: 'popart', intensity: 90 };
  const without = await applyBackgroundEffect(ground, spec, colours, anchor);
  const box = { left: 150, top: 300, width: 300, height: 60 }; // straight across the burst
  const kept = await applyBackgroundEffect(ground, spec, colours, anchor, [box]);
  const region = async (png) => sharp(png).extract(box).removeAlpha().raw().toBuffer();
  const distinct = (buf) => new Set(Array.from({ length: buf.length / 3 }, (_, i) => `${buf[i * 3]},${buf[i * 3 + 1]},${buf[i * 3 + 2]}`)).size;
  assert.ok(distinct(await region(without)) > 3, 'without the box the burst and dots are there');
  assert.equal(distinct(await region(kept)), 1, 'inside the box there is one flat colour: no burst, no dots');
  const outsideA = await sharp(without).extract({ left: 0, top: 0, width: 600, height: 280 }).removeAlpha().raw().toBuffer();
  const outsideB = await sharp(kept).extract({ left: 0, top: 0, width: 600, height: 280 }).removeAlpha().raw().toBuffer();
  assert.ok(outsideA.equals(outsideB), 'the rest of the background is the same');
  const ht = await applyBackgroundEffect(ground, { id: 'halftone', intensity: 90 }, colours, anchor, [box]);
  assert.equal(distinct(await region(ht)), 1, 'halftone dots also keep out of the box');
});

test('in a drawn ad the Pop Art shapes stay out of the sub-line box', async () => {
  const mug = await sharp({ create: { width: 300, height: 380, channels: 4, background: { r: 235, g: 235, b: 235, alpha: 1 } } }).png().toBuffer();
  const seen = [];
  const png = await renderDesign({ archetype: 'product', width: 1080, height: 1080, palette: PAL, product: mug, organiser: 'Fernhill Home', headline: 'Plain Mug', subline: 'White ceramic from Fernhill Home', cta: 'Shop now', finish: 0, effect: { id: 'popart', intensity: 100 }, onLayout: (l) => seen.push(l) });
  const l = seen[0];
  // A thin strip of background at the left edge of the sub-line row: it must be one flat tone, with no dots or burst.
  const strip = await sharp(png).extract({ left: 44, top: Math.round(l.textBottom - 10), width: 10, height: 4 }).removeAlpha().raw().toBuffer();
  const tones = new Set();
  for (let i = 0; i < strip.length; i += 3) tones.add(`${strip[i]},${strip[i + 1]},${strip[i + 2]}`);
  // A soft gradient may step by a few levels; a dot or a burst edge would jump by far more.
  const all = [...tones].map((k) => k.split(',').map(Number));
  const spread = Math.max(...[0, 1, 2].map((c) => Math.max(...all.map((x) => x[c])) - Math.min(...all.map((x) => x[c]))));
  assert.ok(spread <= 20, `the background beside the sub-line is flat (spread ${spread})`);
});

// ---- 4 and 2. Approved group, a card being worked on --------------------------------------------------

const concept = (o = {}) => ({ round: 1, imageB64: 'x', imageMime: 'image/jpeg', headline: 'H', body: 'B', score: 7, defects: [], breakdown: null, fidelity: { sameProduct: true, differences: [] }, folioCheck: { passed: true, reason: null }, models: [], ...o });
const flags = { person_or_hand: false, several_products: false, visible_brand_or_logo: false, watermark: false, busy_background: false, low_resolution: false };
const item = (o = {}) => ({
  id: 'a', row: { sku: 'a', product: 'mug', audience: 'x', image: 'a.jpg', shop: '', fact: '' }, photoUrl: 'x', check: { ran: true, flags, width: 1200, height: 1200, via: 'x' },
  checkStatus: 'done', runAnyway: false, runStatus: 'done', run: { status: 'done', concepts: [concept()], finalPickIndex: 0, notes: [] }, progress: '', error: null, approval: 'pending', ...o,
});

test('an approved ad moves to its own Approved group, shown first; it is not Ready and not Check these', () => {
  assert.equal(groupOf(item()), 'check');
  assert.equal(groupOf(item({ approval: 'approved' })), 'approved');
  assert.equal(groupOf(item({ approval: 'approved', run: { status: 'done', concepts: [concept({ score: 9 })], finalPickIndex: 0, notes: [] } })), 'approved');
  assert.equal(GROUP_LABEL.approved, 'Approved');
  assert.deepEqual(Object.keys(GROUP_LABEL), ['approved', 'held', 'check', 'ready']);
  assert.equal(resultRows([item({ approval: 'approved' })])[0].group, 'Approved');
});

test('a card with an ad on it stays in its group while it is revised or restyled, and says it is working', () => {
  const live = item({ runStatus: 'running', working: 'Revising' });
  assert.equal(groupOf(live), 'check', 'not moved to Not made yet');
  assert.equal(groupOf(item({ runStatus: 'running', working: 'Revising', approval: 'approved' })), 'approved');
  assert.equal(groupOf(item({ runStatus: 'queued', run: null })), 'pending', 'a product with no ad yet is not made yet');
  assert.equal(isWorking(live), true);
  assert.equal(isWorking(item({ working: 'Drawing the new effect' })), true, 'restyling needs no run status');
  assert.equal(isWorking(item()), false);
});

// ---- 3. the round counter, per ad ----------------------------------------------------------------------

test('rounds are counted per ad from 1 and only a revision that ran adds one', () => {
  assert.equal(adRound([concept({ round: 1 }), concept({ round: 2 })]), 1, 'the two quick rounds of the first run are still round 1 of the ad');
  assert.equal(adRound([concept({ round: 1 }), concept({ round: 2 }), concept({ round: 3, revisionOf: { round: 2, note: '' } })]), 2);
  assert.equal(adRound([concept({ round: 1 }), concept({ round: 2 }), concept({ round: 3, revisionOf: { round: 2, note: '' } }), concept({ round: 4, revisionOf: { round: 3, note: '' } })]), 3);
  const s = startRevision({ ...initialRunState, status: 'running' }, { fromRound: 2, round: 3, note: '', adRound: 2 });
  assert.equal(progressLine({ ...s, status: 'running' }), 'Revising as round 2', 'the first revision is round 2, not round 3');
  const later = startRevision({ ...initialRunState }, { fromRound: 4, round: 5, note: '', adRound: 3 });
  assert.equal(progressLine({ ...later, status: 'running' }), 'Revising as round 3', 'and the second is round 3, not round 5');
});

// ---- 6. the export message -------------------------------------------------------------------------------

test('Export feedback data says what it saved, or that there is nothing yet', () => {
  const none = feedbackFile([], '2026-10-29');
  assert.equal(none.count, 0);
  assert.match(none.message, /^No feedback saved yet\./);
  const row = { created_at: '2026-10-29T10:00:00Z', brief_type: 'product', audience: 'x', critic_overall: 7, critic_parts: null, critic_cap_reason: null, human_score: 6, direction: 'too_high', reason: 'the date is small', round: 1 };
  const one = feedbackFile([row], '2026-10-29');
  assert.equal(one.count, 1);
  assert.match(one.message, /^Saved exported-feedback-data-2026-10-29\.jsonl with 1 record\.$/);
  assert.equal(one.fileName, 'exported-feedback-data-2026-10-29.jsonl');
  assert.match(feedbackFile([row, row, row], '2026-10-29').message, /with 3 records\.$/);
  assert.ok(one.text.endsWith('\n') && one.text.trim().startsWith('{'));
});

// ---- Effect for all ads ---------------------------------------------------------------------------------

import { bulkPlan, bulkSummary } from '../../src/lib/catalogue/model.ts';
import { runPool } from '../../src/lib/catalogue/batch.ts';

const withStyle = (extra = {}, over = {}) => item({ run: { status: 'done', concepts: [concept({ style: { look: 'loud', theme: 'evergreen', effect: null, stylised: false, effectable: true }, ...extra })], finalPickIndex: 0, notes: [], cutoutB64: 'abc' }, ...over });

test('an effect for all ads reaches every finished ad that can take it, and leaves the rest alone and counted', () => {
  const plain = withStyle();
  const hand = withStyle({ manualEffect: true });
  const overridden = withStyle({}, { override: { effect: { id: 'none', intensity: 70, stylise: false } } });
  const photo = withStyle({ style: { look: 'loud', theme: 'evergreen', effect: null, stylised: false, effectable: false } });
  const busy = withStyle({}, { working: 'Revising', runStatus: 'running' });
  const edited = withStyle({ edited: true });
  const approved = withStyle({}, { approval: 'approved' });
  const none = item({ runStatus: 'idle', run: null });
  const plan = bulkPlan([plain, hand, overridden, photo, busy, edited, approved, none]);
  assert.equal(plan.redraw.length, 3, 'plain, edited and approved ads are redrawn: edited words and approval are kept');
  assert.equal(plan.byHand.length, 2, 'a manual effect and a per-product effect are skipped');
  assert.equal(plan.photographs.length, 1);
  assert.equal(plan.busy.length, 1);
  assert.ok(plan.redraw.includes(edited) && plan.redraw.includes(approved));
  assert.match(bulkSummary(3, 0, plan), /^Redrew 3 ads\. 2 skipped because you set their effects by hand\. 1 skipped because effects apply to cut-out ads only \(it uses the whole photo\)\. 1 skipped because it is being made\. Scores are out of date until you revise an ad\.$/);
  assert.match(bulkSummary(1, 1, { redraw: [], byHand: [], photographs: [], busy: [] }), /^Redrew 1 ad\. 1 could not be redrawn\./);
  assert.ok(!/[–—]/.test(bulkSummary(3, 0, plan)));
});

test('the redraws run at most four at a time', async () => {
  let live = 0;
  let peak = 0;
  const { results } = await runPool(Array.from({ length: 12 }, (_, i) => i), async (i) => { live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 15)); live--; return i; }, { concurrency: 4 });
  assert.equal(peak, 4);
  assert.equal(results.length, 12);
});
