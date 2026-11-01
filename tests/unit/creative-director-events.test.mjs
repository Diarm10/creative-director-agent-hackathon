// Fake-client test of runCreativeLoop. Muse Spark, Muse Image and SAM are faked; the layout engine is
// real, so every concept is a genuinely rendered, JPEG-encoded design.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

process.env.MODEL_API_KEY = 'test-fake-key'; // satisfies client.ts's required() guard, never used for a real call

const scenePng = await sharp({ create: { width: 128, height: 128, channels: 3, background: { r: 230, g: 226, b: 218 } } }).png().toBuffer();
const cutoutPng = await sharp({ create: { width: 60, height: 80, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 1 } } }).png().toBuffer();

const noisyPng = await sharp({ create: { width: 128, height: 128, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 60 } } }).png().toBuffer();

const state = {
  scene: scenePng,
  inspection: { description: 'a case', printed_text: [] },
  calls: { generateImage: 0, editImage: 0 },
  prompts: [],
  critique: { score: 5 },
  fidelity: [], // queue of sameProduct booleans, default true
  plan: { archetype: 'typographic', art_prompt: 'a calm table', headline: 'Build for Your World', subline: 'An evening of demos', badge: [], cta: 'RSVP online', pattern: 'grid' },
};

mock.module('../../src/lib/meta/client.ts', {
  namedExports: {
    MODELS: { text: 'muse-spark-1.3', image: 'muse-image-1.0', segment: 'sam-3.1' },
    meta: {
      responses: {
        create: async ({ input }) => {
          const prompt = input[0].content[0].text;
          if (prompt.includes('Look at this product photo')) return { output_text: JSON.stringify(state.inspection) };
          if (prompt.includes('Image 1 is the real product')) {
            state.prompts.push(prompt);
            const same = state.fidelity.length ? state.fidelity.shift() : true;
            return { output_text: JSON.stringify({ sameProduct: same, differences: same ? [] : ['lid is open'] }) };
          }
          state.prompts.push(prompt);
          return {
            output_text: JSON.stringify({
              score: 5, biggest_weakness: 'Spacing is tight', fix: 'Add space', text_in_image: [], product_halo: false,
              product_faded: false, awkward_crop: false, illegible_text: false, generic_or_ai_look: false, ...state.critique,
            }),
          };
        },
      },
    },
    text: async (input) => {
      state.prompts.push(input);
      if (input.includes('senior designer')) return JSON.stringify(state.plan);
      if (input.includes('Banned claims')) return JSON.stringify({ claims: [] });
      return '{}';
    },
    generateImage: async (prompt) => { state.prompts.push(prompt); state.calls.generateImage++; return state.scene.toString('base64'); },
    editImage: async () => { state.calls.editImage++; return state.scene.toString('base64'); },
    ImageBudget: class { async take() {} },
  },
});
mock.module('../../src/lib/meta/segment.ts', {
  namedExports: {
    cutOutProduct: async () => ({ png: cutoutPng, box: { left: 0, top: 0, width: 60, height: 80 }, matches: 1, method: 'concept', prompt: 'test' }),
    locateInScene: async () => null,
  },
});

globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(10) });
// The measured part of the score has its own tests (quality-score.test.mjs); here the critic's score is the one under test.
const realQuality = await import('../../src/lib/meta/quality.ts');
mock.module('../../src/lib/meta/quality.ts', { namedExports: { ...realQuality, measureQuality: async () => ({ delta: 0, faults: [], goods: [] }) } });
const { runCreativeLoop, runRevision } = await import('../../src/lib/meta/loop.ts');
const { sanitiseRevision } = await import('../../src/lib/meta/revision.ts');

const productBrief = {
  briefType: 'product', clientName: 'Sparks Audio', productNoun: 'earbuds case', productImageUrl: 'data:image/png;base64,ZmFrZQ==',
  offer: '20% off this week', audience: 'commuters',
};
const eventBrief = {
  briefType: 'event', clientName: 'Dublin Builders Meetup', title: 'Build for Your World', eventDate: 'Thu 20 Nov, 7pm',
  eventPlace: 'The Dock, Dublin', cta: 'RSVP online', audience: 'developers',
};
const reset = () => {
  state.calls.generateImage = 0; state.calls.editImage = 0; state.prompts.length = 0; state.fidelity.length = 0;
  state.critique = { score: 5 };
  state.scene = scenePng;
  state.inspection = { description: 'a case', printed_text: [] };
  state.plan = { archetype: 'typographic', art_prompt: 'a calm table', headline: 'Build for Your World', subline: 'An evening of demos', badge: [], cta: 'RSVP online', pattern: 'grid' };
};
// model_used events are reported as they happen between the pipeline events; the order test is about the pipeline.
const types = (events) => events.filter((e) => e.type !== 'model_used').map((e) => e.type);

// A revision keeps the layout family of the round it refines, which is how these tests reach a scene round directly.
function refine(brief, archetype) {
  return runRevision(brief, sanitiseRevision({
    fromRound: 1, round: 2, headline: 'Build for Your World', subline: 'An evening of demos', cta: 'RSVP online',
    plan: { archetype, artPrompt: 'a calm table', pattern: 'grid', variant: null, colours: [], badge: [], ctaScale: 1, gapScale: 1 },
    note: '', weakness: '', fix: '',
  }), () => {});
}

test('product brief: the three rounds are three directions, events arrive in order, JPEG concepts', async () => {
  reset();
  const events = [];
  const result = await runCreativeLoop(productBrief, (e) => events.push(e));

  const t = types(events);
  assert.deepEqual(t.slice(0, 4), ['run_started', 'cutout_started', 'cutout_done', 'cutout_full']);
  assert.equal(t.at(-1), 'final_picked');
  assert.equal(t.filter((x) => x === 'round_started').length, 3);
  // Round 1, type behind the product, is built from the cut-out alone: no scene step.
  assert.deepEqual(t.slice(4, 8), ['round_started', 'copy_done', 'scene_done', 'composite_done']);
  assert.equal(events.find((e) => e.type === 'scene_done').skipped, true);
  assert.equal(t.filter((x) => x === 'scene_started').length, 1, 'only the photographic scene round makes a picture');
  assert.equal(state.calls.editImage, 1, 'one Muse Image edit in the whole run');
  assert.equal(state.calls.generateImage, 0);
  assert.deepEqual(result.concepts.map((c) => c.method), ['type behind product', 'one-pass edit', 'layout composite']);
  assert.deepEqual(result.concepts.map((c) => c.archetype), ['behind', 'artwork', 'product']);
  assert.deepEqual(result.concepts.map((c) => c.direction), ['Type behind product', 'Photographic scene', 'Clean studio']);
  for (const c of result.concepts) {
    assert.equal(c.imageMime, 'image/jpeg');
    assert.equal(Buffer.from(c.imageB64, 'base64')[0], 0xff);
  }
  const thumb = events.find((e) => e.type === 'cutout_done').thumbnailB64;
  assert.ok((await sharp(Buffer.from(thumb, 'base64')).metadata()).width <= 256);
});

test('a score of 8 or more stops the loop after one round', async () => {
  reset();
  state.critique = { score: 9 };
  const events = [];
  await runCreativeLoop(productBrief, (e) => events.push(e));
  assert.equal(types(events).filter((x) => x === 'round_started').length, 1);
});

test('an event brief starts with a typographic colour block: no image calls, and scene and fidelity are skipped', async () => {
  reset();
  state.critique = { score: 9 };
  const events = [];
  const result = await runCreativeLoop(eventBrief, (e) => events.push(e));
  assert.equal(state.calls.generateImage + state.calls.editImage, 0);
  assert.equal(result.concepts[0].method, 'typographic');
  assert.equal(result.concepts[0].direction, 'Bold colour block');
  assert.equal(result.concepts[0].plan.variant, 'block', 'the direction fixes the composition');
  assert.equal(events.find((e) => e.type === 'scene_done').skipped, true);
  assert.equal(events.find((e) => e.type === 'fidelity_checked').skipped, true);
  assert.ok(!types(events).includes('cutout_started'), 'no SAM for an event');
});

test('the three event rounds are different directions: block, scene, line pattern', async () => {
  reset();
  const result = await runCreativeLoop(eventBrief, () => {});
  assert.deepEqual(result.concepts.map((c) => c.direction), ['Bold colour block', 'Photographic scene', 'Line pattern poster']);
  assert.deepEqual(result.concepts.map((c) => c.plan.variant).filter(Boolean), ['block', 'anchor']);
  assert.equal(state.calls.generateImage, 1, 'only the scene round makes a picture');
});

test('an artwork round for an event calls Muse Image once with the artwork-only rules', async () => {
  reset();
  state.critique = { score: 9 };
  await refine(eventBrief, 'artwork');
  assert.equal(state.calls.generateImage, 1);
  assert.ok(state.prompts.some((p) => p.includes('Artwork only')), 'the artwork-only rules went into the image prompt');
});

test('a product scene that fails the fidelity check is capped at 4, and the last direction is the clean studio', async () => {
  reset();
  state.fidelity.push(false);
  const result = await runCreativeLoop(productBrief, () => {});
  assert.deepEqual(result.concepts.map((c) => c.method), ['type behind product', 'one-pass edit', 'layout composite']);
  assert.equal(state.calls.editImage, 1, 'the studio round uses the real cut-out, no image model');
  assert.equal(result.concepts[1].fidelity.sameProduct, false);
  assert.ok(result.concepts[1].score <= 4, 'a fidelity mismatch caps the score');
  assert.match(result.concepts[1].defects.join(' '), /Product differs/);
});

test('stray text in the artwork caps the score at 4 and is shown as a defect', async () => {
  reset();
  state.critique = { score: 9, text_in_image: ['Shop Now'] };
  const result = await runCreativeLoop(eventBrief, () => {});
  assert.equal(result.concepts[0].score, 4);
  assert.match(result.concepts[0].defects[0], /Shop Now/);
});

test('the Offer reaches the folio check as approved text for the run', async () => {
  reset();
  state.critique = { score: 9 };
  await runCreativeLoop({ ...productBrief, folio: { brandColours: [], headingFont: 'Inter', bodyFont: 'Inter', logoUrl: null, approvedFacts: ['Holds three charges'], bannedClaims: ['medical claims'], bannedWords: [] } }, () => {});
  const folioPrompt = state.prompts.find((p) => p.includes('Banned claims'));
  assert.match(folioPrompt, /typed in by the user\): [^\n]*20% off this week/);
});

test('a failed photo fetch is emitted as an error event and rethrown', async () => {
  reset();
  const saved = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  const events = [];
  try {
    await assert.rejects(runCreativeLoop(productBrief, (e) => events.push(e)));
  } finally {
    globalThis.fetch = saved;
  }
  assert.equal(events.at(-1).type, 'error');
});

test('text printed on the real product is told to every check and never costs the score', async () => {
  reset();
  state.inspection = { description: 'a round sticker', printed_text: ['CIRCLES 2026', 'SUBJECT'] };
  state.critique = { score: 9, text_in_image: ['CIRCLES 2026'] };
  const folio = { brandColours: [], headingFont: 'Inter', bodyFont: 'Inter', logoUrl: null, approvedFacts: ['A sticker'], bannedClaims: ['medical claims'], bannedWords: [] };
  const result = await refine({ ...productBrief, folio }, 'artwork');
  assert.equal(result.concepts[0].score, 9, 'product text is not stray text');
  assert.deepEqual(result.concepts[0].defects, []);
  const critiquePrompt = state.prompts.find((p) => p.includes('art director'));
  assert.match(critiquePrompt, /printed on it: "CIRCLES 2026", "SUBJECT"/);
  const fidelityPrompt = state.prompts.find((p) => p.includes('Image 1 is the real product'));
  assert.match(fidelityPrompt, /printed on it: "CIRCLES 2026", "SUBJECT"/);
  const folioPrompt = state.prompts.find((p) => p.includes('Banned claims'));
  assert.match(folioPrompt, /typed in by the user\): [^\n]*CIRCLES 2026/);
});

test('stray text on the background still counts when the product has printed text of its own', async () => {
  reset();
  state.inspection = { description: 'a round sticker', printed_text: ['CIRCLES 2026'] };
  state.critique = { score: 9, text_in_image: ['CIRCLES 2026', 'Shop Now'] };
  const result = await runCreativeLoop(productBrief, () => {});
  assert.equal(result.concepts[0].score, 4);
  assert.equal(result.concepts[0].defects.length, 1);
  assert.match(result.concepts[0].defects[0], /Shop Now/);
});

test('the call to action is its own field and never joined to the subline', async () => {
  reset();
  state.critique = { score: 9 };
  const given = await runCreativeLoop(eventBrief, () => {});
  assert.equal(given.concepts[0].cta, 'RSVP online', 'the CTA the user supplied');
  assert.equal(given.concepts[0].body, 'An evening of demos');
  assert.ok(!given.concepts[0].body.includes('RSVP'));

  state.plan.cta = '';
  const { cta, ...noCta } = eventBrief;
  const defaulted = await runCreativeLoop(noCta, () => {});
  assert.equal(defaulted.concepts[0].cta, 'Find out more');
  state.plan.cta = '';
  const product = await runCreativeLoop(productBrief, () => {});
  assert.equal(product.concepts[0].cta, 'Shop now');
});

test('a product scene with no calm space for type falls back to the clean composite, never a smear', async () => {
  reset();
  state.scene = noisyPng;
  state.critique = { score: 9 };
  const result = await refine(productBrief, 'artwork');
  assert.equal(result.concepts[0].method, 'layout composite');
  assert.equal(state.calls.editImage, 1, 'the scene was tried once, then discarded');
});

