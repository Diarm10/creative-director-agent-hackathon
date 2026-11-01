// The table lamp case from the live app: a cut-out with gaps makes the studio layout the first design, and then the note
// "The lamp looks small and the bottom of the ad is empty. Please make the lamp bigger." must change the ad. The cause of the
// silent identical ad was the page, not the layout: after a revision it showed the best scoring round, which was the old ad.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

process.env.MODEL_API_KEY = 'test-fake-key';

// A wire-frame product: a thick outline of a tall shape. It is one piece, but under 35 percent solid, like the real lamp.
const W = 800, H = 600, BOX = { left: 270, top: 70, width: 260, height: 440 };
const photo = await sharp({ create: { width: W, height: H, channels: 3, background: { r: 225, g: 225, b: 228 } } }).png().toBuffer();
const frame = (() => {
  const raw = Buffer.alloc(BOX.width * BOX.height * 4, 0);
  const t = 12; // frame thickness
  for (let y = 0; y < BOX.height; y++) for (let x = 0; x < BOX.width; x++) {
    if (x < t || y < t || x >= BOX.width - t || y >= BOX.height - t || Math.abs(x - y * 0.6) < 5) {
      const i = (y * BOX.width + x) * 4;
      raw[i] = 20; raw[i + 1] = 20; raw[i + 2] = 22; raw[i + 3] = 255;
    }
  }
  return sharp(raw, { raw: { width: BOX.width, height: BOX.height, channels: 4 } }).png().toBuffer();
})();
const cutoutPng = await frame;

const state = { plan: {}, scores: [7] };
mock.module('../../src/lib/meta/client.ts', {
  namedExports: {
    MODELS: { text: 'muse-spark-1.3', image: 'muse-image-1.0', segment: 'sam-3.1' },
    meta: {
      responses: {
        create: async ({ input }) => {
          const prompt = input[0].content[0].text;
          if (prompt.includes('Look at this product photo')) return { output_text: JSON.stringify({ description: 'a black table lamp', visible: ['black arm', 'wire shade'], printed_text: [] }) };
          if (prompt.includes('Image 1 is the real product')) return { output_text: JSON.stringify({ sameProduct: true, differences: [] }) };
          const score = state.scores.length > 1 ? state.scores.shift() : state.scores[0];
          const part = (n) => ({ score: n, note: 'ok' });
          return { output_text: JSON.stringify({ parts: { legibility: part(7), hierarchy: part(7), composition: part(score), brandFit: part(7), fidelity: part(8), originality: part(score) }, biggest_weakness: 'composition', fix: 'x', text_in_image: [], product_halo: false, product_faded: false, awkward_crop: false, illegible_text: false, generic_or_ai_look: false }) };
        },
      },
    },
    text: async (input) => {
      if (input.includes('senior designer')) return JSON.stringify({ archetype: 'behind', art_prompt: '', badge: [], cta: 'Shop gifts', pattern: 'grid', headline: 'Give This Lamp', subline: 'Black arm and a wire shade', ...state.plan });
      if (input.includes('Banned claims')) return JSON.stringify({ claims: [] });
      return '{}';
    },
    generateImage: async () => { throw new Error('no image'); },
    editImage: async () => { throw new Error('no image'); },
    ImageBudget: class { async take() {} },
  },
});
mock.module('../../src/lib/meta/segment.ts', {
  namedExports: {
    cutOutProduct: async () => ({ png: cutoutPng, box: BOX, matches: 1, method: 'concept', prompt: 'test', photoPng: photo }),
    locateInScene: async () => null,
  },
});
globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => photo.buffer.slice(photo.byteOffset, photo.byteOffset + photo.byteLength) }); // the real photo, so the cut-out check can measure it
console.info = () => {};
const { runCreativeLoop, runRevision } = await import('../../src/lib/meta/loop.ts');
const { sanitiseRevision } = await import('../../src/lib/meta/revision.ts');
const { revisionOutcome } = await import('../../src/lib/meta/lookCompare.ts');
const { initialRunState, reduceRun, showRound } = await import('../../src/components/creative-director/runState.ts');

const brief = { briefType: 'product', clientName: 'Fernhill Home', productNoun: 'table lamp', productImageUrl: 'data:image/png;base64,ZmFrZQ==', audience: 'online shoppers', facts: 'A table lamp with a black arm and a wire shade', look: 'loud', theme: 'christmas', maxRounds: 1 };
const NOTE = 'The lamp looks small and the bottom of the ad is empty. Please make the lamp bigger.';
const height = (c) => c.layout.productBottom - c.layout.productTop;

test('a cut-out with gaps falls back to the studio layout under Loud Poster, and says so', async () => {
  const events = [];
  const result = await runCreativeLoop(brief, (e) => events.push(e));
  const c = result.concepts[0];
  assert.equal(c.archetype, 'product');
  assert.equal(c.method, 'layout composite');
  assert.ok(events.some((e) => e.type === 'fallback_note' && /studio layout was used instead of type behind the product/.test(e.message)));
  assert.equal(c.plan.archetype, 'product', 'a revision keeps the studio layout');
});

test('the lamp note enlarges the product up to the bottom margin and the card says what moved', async () => {
  const first = await runCreativeLoop(brief);
  const base = first.concepts[0];
  const rev = sanitiseRevision({ fromRound: 1, round: 2, headline: base.headline, subline: base.body, cta: base.cta, plan: base.plan, note: NOTE, weakness: '', fix: '' });
  const out = await runRevision(brief, rev, () => {});
  const revised = out.concepts[0];
  assert.equal(base.layout.mode, 'composite');
  assert.ok(height(revised) >= height(base) * 1.03, `the lamp is ${height(base)} px tall before and ${height(revised)} px after`);
  assert.ok(revised.layout.productBottom <= 1080 - 72 + 2, `it stops at the bottom margin: ${revised.layout.productBottom}`);
  assert.ok(revised.revisionOf.applied.includes('made the product larger'), revised.revisionOf.applied.join('; '));
  assert.equal(revisionOutcome([base, revised], revised).changed, true);
  assert.notEqual(revised.look, base.look, 'the picture is different');
});

test('a lamp already at its largest says Nothing changed, with the reason, never a silent identical ad', async () => {
  const first = await runCreativeLoop(brief);
  const base = first.concepts[0];
  const rev = sanitiseRevision({ fromRound: 1, round: 2, headline: base.headline, subline: base.body, cta: base.cta, plan: { ...base.plan, productScale: 1.3 }, note: NOTE, weakness: '', fix: '' });
  const revised = (await runRevision(brief, rev, () => {})).concepts[0];
  const outcome = revisionOutcome([base, revised], revised);
  assert.equal(outcome.changed, false);
  assert.match(outcome.message, /^Nothing changed\. I could not act on that note: the product is already at the largest size allowed\.$/);
});

test('the cause of the silent ad: a revision that scores lower left the old ad on the card; now the revised ad is shown', async () => {
  state.scores = [7];
  const first = await runCreativeLoop(brief);
  const base = first.concepts[0];
  state.scores = [1]; // the revision scores lower than the ad it started from
  const rev = sanitiseRevision({ fromRound: 1, round: 2, headline: base.headline, subline: base.body, cta: base.cta, plan: base.plan, note: NOTE, weakness: '', fix: '' });
  const revised = (await runRevision(brief, rev, () => {})).concepts[0];
  assert.ok(revised.score < base.score, `${revised.score} against ${base.score}`);
  // What the page state did before: it picked the best scoring round, which is the old ad, so nothing seemed to change.
  let st = { ...initialRunState, status: 'done', concepts: [base], finalPickIndex: 0 };
  st = reduceRun(st, { type: 'result', revision: true, result: { concepts: [revised], finalPickIndex: 0 }, imagesOmitted: false });
  assert.equal(st.finalPickIndex, 0, 'the generic re-pick keeps the old, better scoring ad');
  // The Catalogue now shows the revised round.
  const shown = showRound(st, revised.round);
  assert.equal(shown.concepts[shown.finalPickIndex].round, revised.round);
  assert.ok(shown.concepts[shown.finalPickIndex].revisionOf, 'so its "Changed:" line or its reason is on the card');
  assert.equal(showRound(st, 99), st, 'an unknown round changes nothing');
  assert.equal(showRound(shown, base.round).finalPickIndex, 0, 'and the person can go back to the earlier ad');
});
