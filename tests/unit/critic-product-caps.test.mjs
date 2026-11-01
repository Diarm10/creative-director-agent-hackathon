// The critic's product caps and the copy rule: a product that is missing, half missing or cut off is capped at 4, text
// hidden by the product at 5, and a headline or subline may not name a colour, material or part the image does not show.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVisionCritique, DEFECT_CAP, TEXT_HIDDEN_CAP } from '../../src/lib/meta/creativeDirectorPure.ts';
import { unseenTerms } from '../../src/lib/meta/visibleCopy.ts';
import { buildCritiquePrompt } from '../../src/lib/meta/prompts.ts';

const part = (score, note = 'ok') => ({ score, note });
const good = { legibility: part(8), hierarchy: part(8), composition: part(8), brandFit: part(8), fidelity: part(8), originality: part(8) };
const raw = (o = {}) => JSON.stringify({ parts: good, biggest_weakness: 'Spacing', fix: 'More space', text_in_image: [], product_halo: false, product_faded: false, awkward_crop: false, illegible_text: false, generic_or_ai_look: false, generic_reason: '', ...o });

test('a clean ad with the product whole keeps its score', () => {
  const c = parseVisionCritique(raw({ product_missing: false, product_partial: false, product_cut_off: false, text_hidden_by_product: false, unseen_in_copy: [] }));
  assert.equal(c.score, 8);
  assert.equal(c.capReason, null);
});

for (const [flag, words] of [['product_missing', /missing from the ad/], ['product_partial', /Only part of the product/], ['product_cut_off', /cut off by the frame/]]) {
  test(`${flag} caps the score at ${DEFECT_CAP} and names the problem`, () => {
    const c = parseVisionCritique(raw({ [flag]: true }));
    assert.equal(c.score, DEFECT_CAP);
    assert.match(c.defects.join(' '), words);
    assert.match(c.capReason, new RegExp(`Capped at ${DEFECT_CAP}`));
  });
}

test('text hidden by the product caps the score at 5, and a missing product still wins with 4', () => {
  const hidden = parseVisionCritique(raw({ text_hidden_by_product: true }));
  assert.equal(TEXT_HIDDEN_CAP, 5);
  assert.equal(hidden.score, 5);
  assert.match(hidden.capReason, /Capped at 5: text is hidden by the product/);
  assert.match(hidden.notes.join(' '), /hidden by the product/);
  assert.equal(parseVisionCritique(raw({ text_hidden_by_product: true, product_partial: true })).score, 4);
});

test('a headline naming something the ad does not show is a defect and caps the score at 4', () => {
  const c = parseVisionCritique(raw({ unseen_in_copy: ['terracotta'] }));
  assert.equal(c.score, 4);
  assert.match(c.defects.join(' '), /names something that cannot be seen in the ad: "terracotta"/);
});

test('the critic prompt asks for these flags for a product ad and not for a graphic', () => {
  const ctx = { briefType: 'product', previous: null, memory: null, hasFolio: false, supplied: [] };
  const product = buildCritiquePrompt(['Snake Plant'], true, 'online shoppers', [], ctx);
  for (const k of ['product_missing', 'product_partial', 'product_cut_off', 'text_hidden_by_product', 'unseen_in_copy']) assert.ok(product.includes(k), k);
  const graphic = buildCritiquePrompt(['Build for Your World'], false, 'developers', [], { ...ctx, briefType: 'event' });
  assert.ok(!graphic.includes('product_missing'));
});

test('unseenTerms: the snake plant headline names terracotta, which the plant-only image does not show', () => {
  const visible = 'a tall snake plant with narrow striped green leaves';
  assert.deepEqual(unseenTerms('Snake Plant In Terracotta', visible), ['terracotta']);
  assert.deepEqual(unseenTerms('Snake Plant For Home Shoppers. Tall, narrow, striped green leaves in terracotta-coloured pot.', visible), ['terracotta', 'pot']);
  assert.deepEqual(unseenTerms('Tall Striped Snake Plant', visible), []);
});

test('unseenTerms: spellings count, the product name counts, and with nothing to check against nothing is flagged', () => {
  assert.deepEqual(unseenTerms('Low Stool, Dark Seat', 'a low wooden stool with a dark seat and legs'), []);
  assert.deepEqual(unseenTerms('Wood Stool', 'a wooden stool'), []);
  assert.deepEqual(unseenTerms('Golden Lamp', 'a lamp with gold joints'), []);
  assert.deepEqual(unseenTerms('Plain White Mug With Handle', 'a white ceramic mug'), ['handle']);
  assert.deepEqual(unseenTerms('Terracotta Pot', ''), []);
});
