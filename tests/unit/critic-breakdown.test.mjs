// The six-part breakdown: parsing, the overall score from the parts, and how caps are explained.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVisionCritique, parseParts, overallFromParts, PART_KEYS } from '../../src/lib/meta/creativeDirectorPure.ts';

const part = (score, note = 'ok') => ({ score, note });
const parts = (o = {}) => ({
  legibility: part(8, 'Type reads clearly'), hierarchy: part(7), composition: part(6), brandFit: part(7), fidelity: part(7), originality: part(5), ...o,
});
const raw = (o = {}) => JSON.stringify({ parts: parts(), biggest_weakness: 'Space is uneven', fix: 'Even it out', text_in_image: [], product_halo: false, product_faded: false, awkward_crop: false, illegible_text: false, generic_or_ai_look: false, generic_reason: '', ...o });
const allNine = () => parts({ legibility: part(9), hierarchy: part(9), composition: part(9), brandFit: part(9), fidelity: part(9), originality: part(9) });

test('all six parts are read, clamped to 1 to 10, with one short note each', () => {
  const p = parseParts(parts({ legibility: part(14, 'x'.repeat(400)), originality: part(0) }));
  assert.deepEqual(Object.keys(p), [...PART_KEYS]);
  assert.equal(p.legibility.score, 10);
  assert.equal(p.originality.score, 1);
  assert.ok(p.legibility.note.length <= 160);
});

test('a breakdown missing a part, or with a non-numeric score, is not accepted', () => {
  const missing = parts();
  delete missing.hierarchy;
  assert.equal(parseParts(missing), null);
  assert.equal(parseParts(parts({ composition: { score: 'high', note: 'x' } })), null);
  assert.equal(parseParts(null), null);
});

test('the overall score is the rounded mean of the six parts', () => {
  assert.equal(overallFromParts(parts()), 7); // (8+7+6+7+7+5)/6 = 6.67
  const ones = Object.fromEntries(PART_KEYS.map((k) => [k, part(1)]));
  assert.equal(overallFromParts(ones), 1);
});

test('the critique carries the breakdown and no cap reason when nothing holds the score down', () => {
  const c = parseVisionCritique(raw());
  assert.equal(c.score, 7);
  assert.equal(c.parts.hierarchy.score, 7);
  assert.equal(c.capReason, null);
  assert.equal(c.available, true);
});

test('a cap is applied and named as the reason', () => {
  const stray = parseVisionCritique(raw({ parts: allNine(), text_in_image: ['Shop Now'] }));
  assert.equal(stray.score, 4);
  assert.equal(stray.rawScore, 9);
  assert.match(stray.capReason, /^Capped at 4: Text in the artwork: "Shop Now"/);
  const crop = parseVisionCritique(raw({ awkward_crop: true }));
  assert.equal(crop.score, 6);
  assert.match(crop.capReason, /^Capped at 6: awkward cropping/);
});

test('the binding cap is the lowest one that actually held the score down', () => {
  const c = parseVisionCritique(raw({ illegible_text: true, awkward_crop: true }));
  assert.equal(c.score, 5);
  assert.match(c.capReason, /^Capped at 5/);
});

test('text printed on the real product is still never a defect, so it never caps or explains a cap', () => {
  const c = parseVisionCritique(raw({ text_in_image: ['CIRCLES 2026'] }), ['Circles 2026']);
  assert.deepEqual(c.defects, []);
  assert.equal(c.capReason, null);
  assert.equal(c.score, 7);
});

test('generic is only counted when the critic names what is generic', () => {
  const unnamed = parseVisionCritique(raw({ generic_or_ai_look: true, generic_reason: '' }));
  assert.equal(unnamed.score, 7);
  assert.deepEqual(unnamed.notes, []);
  assert.equal(unnamed.capReason, null);
  const named = parseVisionCritique(raw({ parts: allNine(), generic_or_ai_look: true, generic_reason: 'the same centred headline over a gradient' }));
  assert.equal(named.score, 7);
  assert.match(named.capReason, /^Capped at 7: generic: the same centred headline over a gradient/);
});

test('an older single-score answer is still accepted, without a breakdown', () => {
  const c = parseVisionCritique(JSON.stringify({ score: 6, biggest_weakness: 'x', fix: 'y' }));
  assert.equal(c.score, 6);
  assert.equal(c.parts, null);
  assert.equal(c.available, true);
});

test('an unusable answer is neutral, never a flat 10, and has no breakdown', () => {
  for (const r of ['', 'nope', '{"parts":{"legibility":{"score":7}}}']) {
    const c = parseVisionCritique(r);
    assert.equal(c.available, false);
    assert.equal(c.score, 5);
    assert.equal(c.parts, null);
  }
});
