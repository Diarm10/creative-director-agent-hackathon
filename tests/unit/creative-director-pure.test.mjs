import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAudienceHeadline, pickFinalRoundIndex, applyFidelityGate, cleanCopy, buildResultEvent, folioRowToInput } from '../../src/lib/meta/creativeDirectorPure.ts';

test('final pick: highest score wins', () => {
  assert.equal(pickFinalRoundIndex([{ round: 1, score: 5 }, { round: 2, score: 8 }, { round: 3, score: 6 }]), 1);
});

test('final pick: a tie goes to the later round, not the first', () => {
  assert.equal(pickFinalRoundIndex([{ round: 1, score: 7 }, { round: 2, score: 7 }]), 1);
});

test('final pick: never just "the last round" when it scored lower', () => {
  // This is the exact bug reported live: scores 5, 6, 6 -- the last round never improved, and the
  // old behaviour ("always the last round") picked round 3 regardless. The fix picks the later of
  // the tied best rounds (round 3, since 6 == 6), which happens to match here, but for the right
  // reason -- score, not position. A clearly-declining case proves the distinction.
  assert.equal(pickFinalRoundIndex([{ round: 1, score: 5 }, { round: 2, score: 6 }, { round: 3, score: 6 }]), 2);
  assert.equal(pickFinalRoundIndex([{ round: 1, score: 9 }, { round: 2, score: 3 }, { round: 3, score: 2 }]), 0);
});

test('final pick: a single round picks itself', () => {
  assert.equal(pickFinalRoundIndex([{ round: 1, score: 1 }]), 0);
});

test('fidelity gate: a product mismatch caps the score at 4', () => {
  assert.equal(applyFidelityGate(9, false), 4);
  assert.equal(applyFidelityGate(3, false), 3);
});

test('fidelity gate: a real match leaves the score untouched', () => {
  assert.equal(applyFidelityGate(9, true), 9);
});

test('copy cleaning: strips em and en dashes from headline and body', () => {
  assert.deepEqual(
    cleanCopy({ headline: 'Fast\u2014reliable', body: 'Q1\u2013Q2 results' }),
    { headline: 'Fast,reliable', body: 'Q1-Q2 results' },
  );
  // Plain digits must be left alone.
  assert.deepEqual(
    cleanCopy({ headline: 'Since 2014', body: '2013 to 2014' }),
    { headline: 'Since 2014', body: '2013 to 2014' },
  );
});

test('copy cleaning: leaves ordinary copy unchanged', () => {
  assert.deepEqual(
    cleanCopy({ headline: 'Built for busy mornings', body: 'Grab-and-go, every day.' }),
    { headline: 'Built for busy mornings', body: 'Grab-and-go, every day.' },
  );
});

test('buildResultEvent keeps images when the response stays under the limit', () => {
  const result = { concepts: [{ imageB64: 'abc' }], finalPickIndex: 0 };
  const e = buildResultEvent(result, 100, 10_000);
  assert.equal(e.imagesOmitted, false);
  assert.equal(e.result.concepts[0].imageB64, 'abc');
});

test('buildResultEvent drops already-streamed images when it would exceed the limit', () => {
  const result = { concepts: [{ imageB64: 'x'.repeat(5000), round: 1 }], finalPickIndex: 0 };
  const e = buildResultEvent(result, 6000, 10_000);
  assert.equal(e.imagesOmitted, true);
  assert.equal(e.result.concepts[0].imageB64, '');
  assert.equal(e.result.concepts[0].round, 1);
  assert.equal(result.concepts[0].imageB64.length, 5000, 'input is not mutated');
});

test('folioRowToInput trims, drops blanks and merges approved claims into approved facts', () => {
  const input = folioRowToInput({
    brand_colours: [' #112233 ', ''], heading_font: 'Georgia', body_font: 'Inter', logo_url: null,
    approved_facts: ['A'], approved_claims: ['B'], banned_claims: null, banned_words: ['  cure '],
  });
  assert.deepEqual(input, {
    brandColours: ['#112233'], headingFont: 'Georgia', bodyFont: 'Inter', logoUrl: null,
    approvedFacts: ['A', 'B'], bannedClaims: [], bannedWords: ['cure'],
  });
});

test('on an equal score: higher legibility, then higher composition, then a photographic scene, then the later round; type behind has no preference', () => {
  const behind = { round: 1, score: 7, archetype: 'behind', legibility: 7, composition: 7 };
  const scene = { round: 2, score: 7, archetype: 'artwork', legibility: 7, composition: 7 };
  assert.equal(pickFinalRoundIndex([behind, scene]), 1, 'all equal: the scene wins over type behind');
  assert.equal(pickFinalRoundIndex([scene, behind]), 0, 'the scene wins whichever round it is');
  assert.equal(pickFinalRoundIndex([{ ...behind, legibility: 8 }, scene]), 0, 'higher legibility wins first');
  assert.equal(pickFinalRoundIndex([behind, { ...scene, legibility: 6, composition: 9 }]), 0, 'legibility is judged before composition');
  assert.equal(pickFinalRoundIndex([{ ...behind, composition: 8 }, scene]), 0, 'then higher composition');
  assert.equal(pickFinalRoundIndex([{ ...behind, score: 6 }, scene]), 1, 'a higher score still wins');
  assert.equal(pickFinalRoundIndex([behind, { ...scene, score: 8 }]), 1);
  assert.equal(pickFinalRoundIndex([{ round: 1, score: 7, archetype: 'product' }, { round: 2, score: 7, archetype: 'behind' }]), 1, 'with nothing else to separate them the later round wins');
  assert.equal(pickFinalRoundIndex([behind, scene, { round: 3, score: 7, archetype: 'product', legibility: 7, composition: 7 }]), 1, 'the scene beats both type behind and studio');
});

test('a headline that is only the audience is recognised; one that uses the product or a fact is not', () => {
  assert.equal(isAudienceHeadline('For Online Shoppers', 'online shoppers'), true);
  assert.equal(isAudienceHeadline('Online Shoppers', 'online shoppers'), true);
  assert.equal(isAudienceHeadline('For the online shopper!', 'online shoppers'), false, 'shopper is not shoppers: a near miss is left to the model');
  assert.equal(isAudienceHeadline('White Mug for Online Shoppers', 'online shoppers'), false);
  assert.equal(isAudienceHeadline('A Plain White Mug', 'online shoppers'), false);
  assert.equal(isAudienceHeadline('', 'online shoppers'), false);
});
