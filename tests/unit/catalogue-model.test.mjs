// Catalogue rules: which photos are ready or need attention, what a finished ad needs a look at, the time
// estimate, the batch pool, and what the approved-only export holds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import {
  attentionReasons, criticLine, estimateRange, estimateText, exportRows, finalConcept, holdReasons, isLowResolution, isReady, nameMissing,
  readyItems, resultNeedsAttention, resultProblems, resultsCsv,
} from '../../src/lib/catalogue/model.ts';
import { buildApprovedZip } from '../../src/lib/catalogue/export.ts';
import { runPool } from '../../src/lib/catalogue/batch.ts';

const clean = { person_or_hand: false, several_products: false, visible_brand_or_logo: false, watermark: false, busy_background: false, low_resolution: false };
const check = (flags = {}) => ({ ran: true, flags: { ...clean, ...flags }, width: 1280, height: 1920, via: 'Muse Spark Open on Baseten' });
const JPEG_B64 = Buffer.from('fake jpeg bytes').toString('base64');
const concept = (extra = {}) => ({
  round: 2, imageB64: JPEG_B64, imageMime: 'image/jpeg', headline: 'Sip slowly', body: 'A white mug', score: 9, defects: [], breakdown: null,
  fidelity: { sameProduct: true, differences: [] }, folioCheck: { passed: true, reason: null },
  models: [{ round: 2, step: 'critic', provider: 'baseten', label: 'Muse Spark Open on Baseten', fellBack: false, reason: null }], ...extra,
});
const done = (c) => ({ status: 'done', concepts: [c], finalPickIndex: 0, notes: [] });
const item = (sku, over = {}) => ({
  id: sku, row: { sku, product: 'white ceramic mug', audience: 'online shoppers', image: `${sku}.jpg` }, photoUrl: 'x', check: check(), checkStatus: 'done',
  runAnyway: false, runStatus: 'idle', run: null, progress: '', error: null, approval: 'pending', ...over,
});

test('each yes from the photo check becomes one plain sentence, and a clean photo has none', () => {
  assert.deepEqual(attentionReasons(check()), []);
  const all = attentionReasons(check({ person_or_hand: true, several_products: true, visible_brand_or_logo: true, watermark: true, busy_background: true, low_resolution: true }));
  assert.equal(all.length, 6);
  assert.match(all[0], /person or a hand/);
  assert.match(all[5], /1280 by 1920/);
});

test('a photo whose check failed is held back, not assumed fine', () => {
  const reasons = attentionReasons({ ran: false, flags: null, width: 0, height: 0, via: null });
  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /did not work/);
  assert.equal(isReady(item('a', { check: { ran: false, flags: null, width: 0, height: 0, via: null } })), false);
});

test('the resolution rule uses the real size: under 700 on the short side is too small', () => {
  assert.equal(isLowResolution(1280, 699), true);
  assert.equal(isLowResolution(1280, 700), false);
  assert.equal(isLowResolution(500, 2000), true);
});

test('a flagged product is not ready until Run anyway is ticked; a product not yet checked is never ready', () => {
  const flagged = item('p', { check: check({ person_or_hand: true }) });
  assert.equal(isReady(flagged), false);
  assert.equal(isReady({ ...flagged, runAnyway: true }), true);
  assert.equal(isReady(item('q', { checkStatus: 'checking', check: null })), false);
});

test('a missing product name holds a product back and Run anyway does not cover it', () => {
  const unnamed = item('u', { row: { sku: 'u', product: 'to be added', audience: 'x', image: 'u.jpg' }, runAnyway: true });
  assert.equal(nameMissing(unnamed), true);
  assert.equal(isReady(unnamed), false);
  assert.match(holdReasons(unnamed)[0], /still to be added/);
  assert.equal(isReady({ ...unnamed, row: { ...unnamed.row, product: 'wooden stool' } }), true);
  assert.equal(nameMissing({ row: { product: '  ' } }), true);
});

test('readyItems picks ready products that have not been made, and never more than 12', () => {
  const many = Array.from({ length: 15 }, (_, i) => item(`s${i}`));
  assert.equal(readyItems(many).length, 12);
  const mixed = [item('a'), item('b', { check: check({ watermark: true }) }), item('c', { runStatus: 'done' }), item('d', { runStatus: 'failed' }), item('e', { runStatus: 'not_run' })];
  assert.deepEqual(readyItems(mixed).map((i) => i.id), ['a', 'd', 'e']);
});

test('the time estimate is 2 to 3 minutes a product, four at a time: 12 products is 6 to 9 minutes', () => {
  assert.deepEqual(estimateRange(12), { low: 6, high: 9 });
  assert.equal(estimateText(12), 'about 6 to 9 minutes for 12 products');
  assert.equal(estimateText(1), 'about 2 to 3 minutes for 1 product');
  assert.equal(estimateText(2), 'about 2 to 3 minutes for 2 products');
  assert.equal(estimateText(9), 'about 6 to 9 minutes for 9 products');
});

test('a finished ad is flagged for a score under 8, a blocked claim, or a product that may not match', () => {
  const good = item('g', { runStatus: 'done', run: done(concept()) });
  assert.deepEqual(resultProblems(good), []);
  assert.equal(resultNeedsAttention(good), false);
  const low = item('l', { runStatus: 'done', run: done(concept({ score: 7 })) });
  assert.equal(resultNeedsAttention(low), true);
  assert.match(resultProblems(low).join(' '), /score is 7 out of 10, under 8/);
  const eight = item('e8', { runStatus: 'done', run: done(concept({ score: 8 })) });
  assert.equal(resultNeedsAttention(eight), false);
  const blocked = item('b', { runStatus: 'done', run: done(concept({ folioCheck: { passed: false, reason: 'it claims free delivery' } })) });
  assert.match(resultProblems(blocked)[0], /A claim was blocked: it claims free delivery/);
  const drift = item('d', { runStatus: 'done', run: done(concept({ fidelity: { sameProduct: false, differences: ['the handle'] } })) });
  assert.match(resultProblems(drift)[0], /may not match your photo: the handle/);
  assert.equal(resultNeedsAttention(item('x', { runStatus: 'running' })), false);
});

test('the result card says which model did the critic step, and says so when it was the fallback', () => {
  assert.match(criticLine(concept()), /Muse Spark Open on Baseten/);
  assert.doesNotMatch(criticLine(concept()), /could not answer/);
  const fell = concept({ models: [{ round: 2, step: 'critic', provider: 'meta', label: 'Muse Spark 1.3 on Meta', fellBack: true, reason: 'timed out' }] });
  assert.match(criticLine(fell), /Muse Spark 1\.3 on Meta/);
  assert.match(criticLine(fell), /first choice could not answer \(timed out\), so this one stepped in/);
  assert.match(criticLine(concept({ models: [] })), /did not report/);
});

test('finalConcept follows the final pick', () => {
  const run = { status: 'done', concepts: [concept({ round: 1, score: 6 }), concept({ round: 2, score: 9 })], finalPickIndex: 1, notes: [] };
  assert.equal(finalConcept({ run }).round, 2);
  assert.equal(finalConcept({ run: null }), null);
});

// ---- groups, the biggest problem and the results table ----

import { groupOf, biggestProblem, plainWeakness, problemLine, resultRows, reviewerLabel, GROUP_LABEL, heldReasons } from '../../src/lib/catalogue/model.ts';

const madeItem = (sku, score, extra = {}, over = {}) => item(sku, { runStatus: 'done', run: done(concept({ score, ...extra })), ...over });

test('four groups: Approved, Held back, Check these (under 8) and Ready (8 or more); unmade products wait', () => {
  assert.deepEqual(Object.values(GROUP_LABEL), ['Approved', 'Held back', 'Check these', 'Ready']);
  assert.equal(groupOf(madeItem('a', 9)), 'ready');
  assert.equal(groupOf(madeItem('b', 8)), 'ready');
  assert.equal(groupOf(madeItem('c', 7)), 'check');
  assert.equal(groupOf(madeItem('d', 7, {}, { approval: 'approved' })), 'approved', 'anything the person approved is Approved');
  assert.equal(groupOf(madeItem('e', 9, { folioCheck: { passed: false, reason: 'x' } })), 'check', 'a blocked claim needs a look whatever the score');
  assert.equal(groupOf(item('f', { check: check({ person_or_hand: true }) })), 'held');
  assert.equal(groupOf(item('g', { runStatus: 'failed', error: 'no product found' })), 'held');
  assert.equal(groupOf(item('h', { runStatus: 'not_run' })), 'held');
  assert.equal(groupOf(item('i')), 'pending', 'a ready photo not made yet');
  assert.equal(groupOf(item('j', { runStatus: 'running' })), 'pending');
  assert.equal(groupOf(item('k', { check: check({ person_or_hand: true }), runAnyway: true })), 'pending', 'Run anyway frees a held photo');
});

test('a held product says why no ad was made', () => {
  assert.match(heldReasons(item('g', { runStatus: 'failed', error: 'no product found' }))[0], /no product found/);
  assert.match(heldReasons(item('h', { runStatus: 'not_run' }))[0], /batch stopped before this product/);
  assert.match(problemLine(item('f', { check: check({ watermark: true }) })), /watermark/);
});

test('the biggest problem is one plain sentence from the critic, never just the score', () => {
  assert.equal(biggestProblem(concept({ score: 7, weakness: 'the date is small' })), 'The date is small.');
  assert.equal(biggestProblem(concept({ score: 7, weakness: 'originality - familiar centred headline on flat colour' })), 'Looks generic: familiar centred headline on flat colour.');
  assert.equal(biggestProblem(concept({ score: 6, weakness: 'fidelity: terracotta pot missing so product is not fully visible' })), 'Product: terracotta pot missing so product is not fully visible.');
  assert.equal(biggestProblem(concept({ score: 4, defects: ['The product is cut off by the frame'], weakness: 'spacing' })), 'The product is cut off by the frame.', 'the hard failure that capped the score comes first');
  assert.match(biggestProblem(concept({ score: 5, folioCheck: { passed: false, reason: 'it claims 24 hours' } })), /^A claim was blocked: it claims 24 hours\.$/);
  assert.match(biggestProblem(concept({ score: 5, fidelity: { sameProduct: false, differences: ['lid is open'] } })), /may not match your photo: lid is open\./);
  const parts = { legibility: { score: 8, note: 'fine' }, composition: { score: 4, note: 'the group sits too low' }, hierarchy: { score: 7, note: 'ok' } };
  assert.equal(biggestProblem(concept({ score: 6, weakness: '', breakdown: { parts, overallBeforeCaps: 6, capReason: null } })), 'Layout: the group sits too low.');
  assert.ok(!/out of 10/.test(biggestProblem(concept({ score: 7 }))), 'it does not just repeat the score');
  assert.equal(plainWeakness('Legibility is the lowest'), 'Hard to read: the lowest.');
  assert.ok(!/[–—]/.test(biggestProblem(concept({ weakness: 'hierarchy – unclear' }))), 'no dashes');
});

test('a Check these item shows its biggest problem, a Ready one does not, and an approved one never does', () => {
  assert.equal(problemLine(madeItem('c', 7, { weakness: 'the date is small' })), 'The date is small.');
  assert.equal(problemLine(madeItem('r', 9)), null);
  assert.equal(problemLine(madeItem('a', 7, { weakness: 'x' }, { approval: 'approved' })), null);
});

test('the results table has the file name, product, headline, score, group and the reviewing model', () => {
  const rows = resultRows([
    madeItem('mug-white', 9, { headline: 'Sip slowly' }),
    madeItem('plant-snake', 7, { headline: 'Tall Striped Snake Plant', models: [{ round: 2, step: 'critic', provider: 'meta', label: 'Muse Spark 1.3 on Meta', fellBack: true, reason: 'timed out' }] }),
    madeItem('stool-wooden', 6, { headline: 'Low Stool' }, { approval: 'approved' }),
    item('pouch-in-hand', { check: check({ person_or_hand: true }) }),
    item('cans-white'),
  ]);
  assert.equal(rows.length, 4, 'a product not made yet has no row');
  assert.deepEqual(rows[0], { file: 'mug-white.jpg', product: 'white ceramic mug', headline: 'Sip slowly', score: '9/10', group: 'Ready', reviewer: 'Muse Spark Open on Baseten' });
  assert.equal(rows[1].group, 'Check these');
  assert.equal(rows[1].reviewer, 'Muse Spark 1.3 on Meta (fallback)');
  assert.equal(rows[2].group, 'Approved');
  assert.deepEqual([rows[3].file, rows[3].group, rows[3].headline, rows[3].score], ['pouch-in-hand.jpg', 'Held back', '', '']);
  assert.equal(reviewerLabel(null), 'not reported');
});
