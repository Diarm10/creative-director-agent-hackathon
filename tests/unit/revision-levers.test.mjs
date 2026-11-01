// "Revise with my feedback" must change the ad. The note's words are mapped to layout changes: "headline cut off" or
// "overlap" tightens the overlap guard, "whole pot" or "plant missing" shows the whole photo, "too generic" forces a new
// headline from a product detail, "bigger" or "smaller" changes the product scale. A revision that changes nothing says so.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

process.env.MODEL_API_KEY = 'test-fake-key';

const stool = readFileSync(new URL('./fixtures/stool-wooden-cutout.png', import.meta.url));
const photo = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 200, g: 200, b: 200 } } }).png().toBuffer();
const meta = await sharp(stool).metadata();

const state = { plan: {}, prompts: [], logs: [] };
mock.module('../../src/lib/meta/client.ts', {
  namedExports: {
    MODELS: { text: 'muse-spark-1.3', image: 'muse-image-1.0', segment: 'sam-3.1' },
    meta: {
      responses: {
        create: async ({ input }) => {
          const prompt = input[0].content[0].text;
          if (prompt.includes('Look at this product photo')) return { output_text: JSON.stringify({ description: 'a low wooden stool', visible: ['wooden seat', 'worn legs', 'chipped paint'], printed_text: [] }) };
          if (prompt.includes('Image 1 is the real product')) return { output_text: JSON.stringify({ sameProduct: true, differences: [] }) };
          return { output_text: JSON.stringify({ score: 7, biggest_weakness: 'Plain', fix: 'x', text_in_image: [], product_halo: false, product_faded: false, awkward_crop: false, illegible_text: false, generic_or_ai_look: false }) };
        },
      },
    },
    text: async (input) => {
      if (input.includes('senior designer')) {
        state.prompts.push(input);
        return JSON.stringify({ archetype: 'behind', art_prompt: '', badge: [], cta: 'Shop now', pattern: 'grid', headline: 'Low Stool Dark Seat', subline: 'Worn wooden legs', ...state.plan });
      }
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
    // The stool cut-out sits in a plain photo, covering the middle of it: a good, whole cut-out.
    cutOutProduct: async () => ({ png: stool, box: { left: 200, top: 150, width: meta.width, height: meta.height }, matches: 1, method: 'concept', prompt: 'test', photoPng: photo }),
    locateInScene: async () => null,
  },
});
globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(10) });
console.info = (...a) => { state.logs.push(a.join(' ')); };
const { runCreativeLoop, runRevision } = await import('../../src/lib/meta/loop.ts');
const { sanitiseRevision, layoutIntent } = await import('../../src/lib/meta/revision.ts');
const { revisionOutcome, NO_CHANGE, lookDistance } = await import('../../src/lib/meta/lookCompare.ts');
const { nextRound, initialRunState, startRevision } = await import('../../src/components/creative-director/runState.ts');
const { progressLine } = await import('../../src/lib/catalogue/client.ts');

const brief = { briefType: 'product', clientName: 'Fernhill Home', productNoun: 'wooden stool', productImageUrl: 'data:image/png;base64,ZmFrZQ==', audience: 'online shoppers', facts: 'A low wooden stool with a dark seat', maxRounds: 1 };

/** A first run, then a revision of its only round with the given note. */
async function reviseWith(note, plan = {}) {
  state.plan = {};
  const first = await runCreativeLoop(brief);
  const base = first.concepts[0];
  state.plan = plan;
  const rev = sanitiseRevision({ fromRound: 1, round: 2, headline: base.headline, subline: base.body, cta: base.cta, plan: base.plan, note, weakness: '', fix: '' });
  const events = [];
  const out = await runRevision(brief, rev, (e) => events.push(e));
  return { base, revised: out.concepts[0], events };
}

// ---- the mapping, on its own ----------------------------------------------------------------

test('layoutIntent maps the words of a note to layout changes', () => {
  assert.equal(layoutIntent('headline cut off').guardSteps, 1);
  assert.equal(layoutIntent('The text is covered by the pot').guardSteps, 1);
  assert.equal(layoutIntent('there is an overlap').guardSteps, 1);
  assert.equal(layoutIntent('I want to see the whole pot').wholePhoto, true);
  assert.equal(layoutIntent('plant missing').wholePhoto, true);
  assert.equal(layoutIntent('the handle is cut off').wholePhoto, true);
  assert.equal(layoutIntent('too generic').newHeadline, true);
  assert.equal(layoutIntent('make it bigger').product, 1);
  assert.equal(layoutIntent('the product is too big').product, -1);
  assert.equal(layoutIntent('make the headline smaller').headline, -1);
  assert.equal(layoutIntent('make the headline smaller').product, 0);
  assert.equal(layoutIntent('make the button bigger').product, 0, 'a button is the planner\'s to size');
  const two = layoutIntent('The headline is cut off. Make the stool bigger');
  assert.equal(two.guardSteps, 1);
  assert.equal(two.product, 1);
  assert.equal(two.wholePhoto, false, 'headline cut off is about the headline, not the product');
  const none = layoutIntent('make it pop');
  assert.deepEqual([none.guardSteps, none.wholePhoto, none.newHeadline, none.product, none.headline], [0, false, false, 0, 0]);
  assert.deepEqual(none.unmatched, ['make it pop']);
});

// ---- each lever, through a real revision ----------------------------------------------------

test('"headline cut off" tightens the overlap guard by a step and the layout reflects it', async () => {
  const { base, revised } = await reviseWith('The headline is cut off');
  assert.equal(base.plan.overlapGuard, 0);
  assert.equal(revised.plan.overlapGuard, 1);
  assert.ok(revised.layout.headlineVisible.at(-1) >= 0.9 - 0.002, `${revised.layout.headlineVisible}`);
  assert.ok(revised.revisionOf.applied.some((a) => /tightened the limit/.test(a)), revised.revisionOf.applied.join('; '));
});

test('"whole pot" forces the whole original photo on the studio layout, as the person asked', async () => {
  const { base, revised, events } = await reviseWith('I want to see the whole pot');
  assert.equal(base.archetype, 'behind');
  assert.equal(revised.archetype, 'product');
  assert.equal(revised.method, 'layout composite');
  assert.ok(events.some((e) => e.type === 'fallback_note' && e.message === 'As you asked, the whole original photo is shown.'));
  assert.ok(revised.revisionOf.applied.includes('showed the whole original photo'));
  const full = events.find((e) => e.type === 'cutout_full');
  assert.equal((await sharp(Buffer.from(full.pngB64, 'base64')).metadata()).width, 800, 'the cut-out sent is the whole photo');
});

test('"too generic" forces a new headline that differs and uses a product detail', async () => {
  // The lazy planner returns the same headline again, so the code must supply one from what the image shows.
  const { base, revised } = await reviseWith('too generic');
  assert.notEqual(revised.headline.toLowerCase(), base.headline.toLowerCase());
  assert.match(revised.headline, /Wooden Seat|Worn Legs|Chipped Paint/i);
  assert.ok(revised.revisionOf.applied.includes('wrote a new headline from a detail of the product'));
  assert.match(state.prompts.at(-1), /called the earlier design generic/);
});

test('"too generic" with a planner that does write a new headline keeps the planner\'s', async () => {
  const { revised } = await reviseWith('too generic', { headline: 'Chipped Paint, Honest Legs' });
  assert.equal(revised.headline, 'Chipped Paint, Honest Legs');
});

test('"bigger" and "smaller" change the product scale, and the drawn product follows', async () => {
  const bigger = await reviseWith('make it bigger');
  assert.equal(bigger.base.plan.productScale, 1);
  assert.ok(bigger.revised.plan.productScale > 1, `${bigger.revised.plan.productScale}`);
  const smaller = await reviseWith('the product is too big');
  assert.ok(smaller.revised.plan.productScale < 1);
  const width = (c) => c.layout.productRight - c.layout.productLeft;
  assert.ok(width(smaller.revised) < width(smaller.base), `product width ${width(smaller.base)} -> ${width(smaller.revised)}`);
});

// ---- a revision that changes nothing says so ------------------------------------------------

test('a note no layout lever understands returns an identical ad, and the page says "Nothing changed. I could not act on that note: <reason>."', async () => {
  const { base, revised } = await reviseWith('make it pop');
  assert.equal(base.headline, revised.headline);
  assert.ok(lookDistance(base.look, revised.look) <= 6, `look distance ${lookDistance(base.look, revised.look)}`);
  const outcome = revisionOutcome([base, revised], revised);
  assert.equal(outcome.changed, false);
  assert.ok(outcome.message.startsWith(NO_CHANGE));
  assert.equal(NO_CHANGE, 'Nothing changed.');
  assert.match(outcome.message, /^Nothing changed\. I could not act on that note: .*no layout change matches "make it pop".*\.$/);
  assert.ok(!/[–—]/.test(outcome.message));
});

test('a revision that did change something is not called unchanged', async () => {
  const { base, revised } = await reviseWith('make it bigger');
  const outcome = revisionOutcome([base, revised], revised);
  assert.equal(outcome.changed, true);
  assert.equal(outcome.message, null);
});

test('lookDistance: identical looks are 0, missing looks count as different, and a normal round has no revisionOf', () => {
  const a = 'f'.repeat(64);
  assert.equal(lookDistance(a, a), 0);
  assert.equal(lookDistance(a, '0'.repeat(64)), 256);
  assert.equal(lookDistance(undefined, a), 256);
  assert.equal(revisionOutcome([], { round: 1, headline: 'x', body: '' }).changed, true);
});

// ---- the trace and the round number ---------------------------------------------------------

test('the log says which words of the note reach the planner and which reach the layout', async () => {
  state.logs.length = 0;
  await reviseWith('The headline is cut off. Make it pop');
  const line = state.logs.find((l) => l.startsWith('[revise]'));
  assert.ok(line, 'a [revise] line was logged');
  assert.match(line, /the planner reads all of it, quoted as data/);
  assert.match(line, /overlap: "the headline is cut off"/);
  assert.match(line, /no layout change matched \["make it pop"\]/);
});

test('the revision is numbered one after the highest round, and that number is what the page shows', () => {
  assert.equal(nextRound([]), 1);
  assert.equal(nextRound([{ round: 1 }]), 2, 'a single round revised once becomes round 2, not 3');
  assert.equal(nextRound([{ round: 1 }, { round: 2 }]), 3);
  assert.equal(nextRound([{ round: 1 }, { round: 2 }, { round: 3 }]), 4);
  const state1 = startRevision({ ...initialRunState, concepts: [{ round: 1 }, { round: 2 }] }, { fromRound: 2, round: nextRound([{ round: 1 }, { round: 2 }]), note: '' });
  assert.equal(state1.round, 3);
  assert.equal(progressLine({ ...state1, status: 'running' }), 'Revising as round 3');
});

// ---- "the lamp looks small and the bottom is empty": the product is scaled up and the ad says what moved -----------------------

const studioBrief = { ...brief, look: 'quiet', maxRounds: 1 };
async function reviseStudio(note) {
  state.plan = { archetype: 'product' };
  const first = await runCreativeLoop(studioBrief);
  const base = first.concepts[0];
  const rev = sanitiseRevision({ fromRound: 1, round: 2, headline: base.headline, subline: base.body, cta: base.cta, plan: base.plan, note, weakness: '', fix: '' });
  const out = await runRevision(studioBrief, rev, () => {});
  return { base, revised: out.concepts[0] };
}

test('layoutIntent: "looks small" and "empty at the bottom" both ask for a larger product', () => {
  for (const note of ['The lamp looks small', 'the product is tiny in the frame', 'there is a lot of empty space at the bottom', 'the bottom is empty', 'fill more of the frame']) {
    assert.equal(layoutIntent(note).product, 1, note);
  }
  assert.equal(layoutIntent('the headline is small').headline, 1);
  assert.equal(layoutIntent('the headline is small').product, 0, 'a small headline is not a small product');
  assert.equal(layoutIntent('the product is too big').product, -1);
});

test('a revision of a small product with an empty bottom draws the product larger, and the card says what moved', async () => {
  const { base, revised } = await reviseStudio('The lamp looks small and the bottom is empty');
  assert.equal(base.archetype, 'product');
  const h = (c) => c.layout.productBottom - c.layout.productTop;
  assert.ok(h(revised) >= h(base) * 1.03, `the product is ${h(base)} px tall before and ${h(revised)} px after`);
  assert.ok(revised.plan.productScale > 1);
  assert.ok(revised.revisionOf.applied.includes('made the product larger'), revised.revisionOf.applied.join('; '));
  assert.equal(revised.plan.productHeight, h(revised), 'the height is carried, so the next revision can tell whether it grew');
  const outcome = revisionOutcome([base, revised], revised);
  assert.equal(outcome.changed, true);
  assert.equal(outcome.message, null);
});

test('a "larger product" that could not grow is never reported as a change: it says why instead', async () => {
  // A note asking again after the product is already at the largest scale: the scale cannot move.
  state.plan = { archetype: 'product' };
  const first = await runCreativeLoop(studioBrief);
  const base = first.concepts[0];
  const rev = sanitiseRevision({ fromRound: 1, round: 2, headline: base.headline, subline: base.body, cta: base.cta, plan: { ...base.plan, productScale: 1.3 }, note: 'make it bigger', weakness: '', fix: '' });
  const out = await runRevision(studioBrief, rev, () => {});
  const revised = out.concepts[0];
  assert.ok(!revised.revisionOf.applied.includes('made the product larger'));
  assert.ok(revised.revisionOf.ignored.some((x) => /already at the largest size allowed/.test(x)), revised.revisionOf.ignored.join('; '));
  const outcome = revisionOutcome([{ ...base, round: 1 }, revised], revised);
  assert.equal(outcome.changed, false);
  assert.match(outcome.message, /^Nothing changed\. I could not act on that note: the product is already at the largest size allowed\.$/);
});
