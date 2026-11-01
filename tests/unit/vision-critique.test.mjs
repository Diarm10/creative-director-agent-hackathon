import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlan, parseVisionCritique, DEFECT_CAP } from '../../src/lib/meta/creativeDirectorPure.ts';

const crit = (o) => JSON.stringify({ score: 9, biggest_weakness: 'Subline is small', fix: 'Raise it', text_in_image: [], product_halo: false, product_faded: false, awkward_crop: false, illegible_text: false, generic_or_ai_look: false, ...o });

test('a clean design keeps its score, and 9 stays possible only when nothing is flagged', () => {
  const c = parseVisionCritique(crit({ score: 9 }));
  assert.equal(c.score, 9);
  assert.deepEqual(c.defects, []);
  assert.equal(c.weakness, 'Subline is small');
});

test('stray text in the artwork caps the score at 4 and names the text', () => {
  const c = parseVisionCritique(crit({ score: 9, text_in_image: ['Shop Now', '20% Off'] }));
  assert.equal(c.score, DEFECT_CAP);
  assert.match(c.defects[0], /Text in the artwork: "Shop Now", "20% Off"/);
});

test('a halo or rectangle around the product caps at 4', () => {
  const c = parseVisionCritique(crit({ score: 8, product_halo: true }));
  assert.equal(c.score, 4);
  assert.deepEqual(c.defects, ['Halo or rectangle around the product']);
});

test('a faded product caps at 4', () => {
  assert.equal(parseVisionCritique(crit({ score: 10, product_faded: true })).score, 4);
});

test('softer problems lower the ceiling without the hard cap', () => {
  assert.equal(parseVisionCritique(crit({ score: 10, awkward_crop: true })).score, 6);
  assert.equal(parseVisionCritique(crit({ score: 10, illegible_text: true })).score, 5);
  assert.equal(parseVisionCritique(crit({ score: 10, generic_or_ai_look: true, generic_reason: 'the same centred headline over a gradient' })).score, 7);
  assert.equal(parseVisionCritique(crit({ score: 10, generic_or_ai_look: true, generic_reason: 'x' })).defects.length, 0);
});

test('out of range or fractional scores are clamped and rounded', () => {
  assert.equal(parseVisionCritique(crit({ score: 14 })).score, 10);
  assert.equal(parseVisionCritique(crit({ score: 0 })).score, 1);
  assert.equal(parseVisionCritique(crit({ score: 6.6 })).score, 7);
});

test('an unusable critique reports unavailable with a neutral score, never a flat 10', () => {
  for (const raw of ['', 'not json', '{"score":"high"}']) {
    const c = parseVisionCritique(raw);
    assert.equal(c.available, false);
    assert.equal(c.score, 5);
  }
});

test('parsePlan falls back to the title and the first allowed archetype', () => {
  const p = parsePlan('garbage', ['typographic', 'artwork'], 'Build for Your World');
  assert.equal(p.headline, 'Build for Your World');
  assert.equal(p.archetype, 'typographic');
  assert.equal(p.pattern, 'diagonals');
});

test('parsePlan respects allowed archetypes, trims, strips dashes and caps badge lines', () => {
  const raw = JSON.stringify({ archetype: 'artwork', art_prompt: 'a wooden table', headline: 'Build\u2014for your world', subline: 'x', badge: ['Free', 'entry', 'third'], cta: 'RSVP', pattern: 'grid' });
  const p = parsePlan(raw, ['artwork'], 'fallback');
  assert.equal(p.archetype, 'artwork');
  assert.equal(p.headline, 'Build,for your world');
  assert.deepEqual(p.badge, ['Free', 'entry']);
  assert.equal(p.pattern, 'grid');
  assert.equal(parsePlan(JSON.stringify({ archetype: 'product' }), ['typographic'], 'f').archetype, 'typographic');
});

import { dedupeBadge } from '../../src/lib/meta/creativeDirectorPure.ts';

test('a badge with the same words as the offer is a repeat even when small words differ', () => {
  assert.deepEqual(dedupeBadge(['10% off', 'Sparks Pocket'], ['10% off the Sparks Pocket this week']), []);
  assert.deepEqual(dedupeBadge(['Free', 'entry'], ['Entry is free']), []);
  assert.deepEqual(dedupeBadge(['New', 'colours'], ['10% off the Sparks Pocket this week']), ['New', 'colours']);
});

test('a badge that repeats text shown elsewhere is dropped, a new one is kept', () => {
  assert.deepEqual(dedupeBadge(['Free', 'entry'], ['An evening of demos', 'Free entry. RSVP online']), []);
  assert.deepEqual(dedupeBadge(['20%', 'off'], ['20% off all workshops until 30 November']), []);
  assert.deepEqual(dedupeBadge(['Limited', 'seats'], ['Thu 20 Nov', 'RSVP online']), ['Limited', 'seats']);
  assert.deepEqual(dedupeBadge([], ['anything']), []);
});

test('parsePlan keeps only valid hex colours from the planner', () => {
  const p = parsePlan(JSON.stringify({ colours: ['#8B3A1E', 'orange', '#F4E3C1', '#12', 5] }), ['typographic'], 'x');
  assert.deepEqual(p.colours, ['#8B3A1E', '#F4E3C1']);
  assert.deepEqual(parsePlan('{}', ['typographic'], 'x').colours, []);
});

import { isProductText, parseProductInspection, defaultCta } from '../../src/lib/meta/creativeDirectorPure.ts';

test('text printed on the real product is never a stray-text defect', () => {
  const raw = JSON.stringify({ score: 9, biggest_weakness: 'x', fix: 'y', text_in_image: ['CIRCLES 2026', 'SUBJECT', 'Shop Now'] });
  const withProductText = parseVisionCritique(raw, ['Circles 2026', 'Subject, est. 2007']);
  assert.equal(withProductText.defects.length, 1, 'only the background text counts');
  assert.match(withProductText.defects[0], /Shop Now/);
  assert.doesNotMatch(withProductText.defects[0], /CIRCLES|SUBJECT/i);
  // With nothing but product text reported, there is no defect and no cap.
  const onlyProduct = parseVisionCritique(JSON.stringify({ score: 9, text_in_image: ['2026'] }), ['CIRCLES 2026']);
  assert.deepEqual(onlyProduct.defects, []);
  assert.equal(onlyProduct.score, 9);
  // Without being told about the product text, the same report is still a defect.
  assert.equal(parseVisionCritique(JSON.stringify({ score: 9, text_in_image: ['CIRCLES 2026'] })).score, 4);
});

test('isProductText matches loosely in both directions and ignores empties', () => {
  assert.equal(isProductText('circles', ['CIRCLES 2026']), true);
  assert.equal(isProductText('CIRCLES 2026 SUBJECT', ['circles 2026']), true);
  assert.equal(isProductText('Shop now', ['CIRCLES 2026']), false);
  assert.equal(isProductText('', ['CIRCLES 2026']), false);
  assert.equal(isProductText('x', []), false);
});

test('parseProductInspection reads description and printed text, tolerating bad output', () => {
  const p = parseProductInspection(JSON.stringify({ description: 'a round sticker', printed_text: ['CIRCLES 2026', '', 'SUBJECT'] }));
  assert.equal(p.description, 'a round sticker');
  assert.deepEqual(p.printedText, ['CIRCLES 2026', 'SUBJECT']);
  assert.deepEqual(parseProductInspection('not json'), { description: '', printedText: [], visible: [] });
  assert.deepEqual(parseProductInspection(JSON.stringify({ description: 'a plant', visible: ['green leaves', '', 'a white pot'] })).visible, ['green leaves', 'a white pot']);
});

test('default calls to action are short and promise nothing', () => {
  assert.equal(defaultCta('product'), 'Shop now');
  assert.equal(defaultCta('event'), 'Find out more');
  assert.equal(defaultCta('promo'), 'Find out more');
});

import { dedupeDetails } from '../../src/lib/meta/creativeDirectorPure.ts';

test('a detail the headline or subline already says is not repeated as a row', () => {
  assert.deepEqual(dedupeDetails(['Free with every ticket'], ['Free with every ticket', 'Get yours']), []);
  assert.deepEqual(dedupeDetails(['20% off this week'], ['Thirty hours in your pocket', 'Charges three times']), ['20% off this week']);
  assert.deepEqual(dedupeDetails(['Thu 20 Nov, 7pm', 'The Dock'], ['Build for Your World', 'Come to The Dock tonight']), ['Thu 20 Nov, 7pm']);
  assert.deepEqual(dedupeDetails([], ['x']), []);
});
