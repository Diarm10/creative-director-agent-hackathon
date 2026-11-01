// Rescue for held-back photos and "Find items in this photo": the gating, the item list parsing, the refusal cases, the cap of 12 rows,
// the rescue path in a run (the cut-out must pass its check, the fidelity check still runs), and the two API routes.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

process.env.MODEL_API_KEY = 'test-fake-key';
process.env.DEMO_CODE = 'right-code';

import { rescueDecision, verifyRescue, parseItems, planItemRows, itemsSummary, itemLabel, MAX_ITEMS, MAX_ROWS, RESCUE_NOT_SEPARATED, ITEMS_NOTE } from '../../src/lib/meta/rescue.ts';

const flags = (o = {}) => ({ ran: true, flags: { person_or_hand: false, several_products: false, visible_brand_or_logo: false, watermark: false, busy_background: true, ...o } });

// ---- gating ---------------------------------------------------------------------------------------

test('a busy background, several products or a small photo can be tried; a person, a brand or a watermark never can', () => {
  assert.deepEqual(rescueDecision(flags(), 'steel flask'), { ok: true, reason: null });
  assert.equal(rescueDecision(flags({ several_products: true }), 'dropper bottle').ok, true);
  for (const [flag, word] of [['person_or_hand', /a person or a hand/], ['visible_brand_or_logo', /a brand name or logo/], ['watermark', /watermark/]]) {
    const d = rescueDecision(flags({ [flag]: true }), 'steel flask');
    assert.equal(d.ok, false, flag);
    assert.match(d.reason, word);
    assert.match(d.reason, /refused for good/);
  }
  assert.equal(rescueDecision(flags({ person_or_hand: true, busy_background: false }), 'mug').ok, false, 'a person is refused even when nothing else is wrong');
});

test('a photo whose check did not run is not rescued: nobody has looked for a person or a logo', () => {
  assert.equal(rescueDecision({ ran: false, flags: null }, 'mug').ok, false);
  assert.match(rescueDecision({ ran: false, flags: null }, 'mug').reason, /did not run/);
  assert.equal(rescueDecision(null, 'mug').ok, false);
});

test('a rescue needs a product name, because the cut-out looks for it by name', () => {
  assert.equal(rescueDecision(flags(), '').ok, false);
  assert.equal(rescueDecision(flags(), 'to be added').ok, false);
  assert.match(rescueDecision(flags(), '  ').reason, /product name first/);
});

test('the server looks again before a rescue: a person, a brand or a watermark is refused, and so is a photo it cannot check', async () => {
  const answer = (o) => async () => JSON.stringify({ person_or_hand: false, several_products: false, visible_brand_or_logo: false, watermark: false, busy_background: true, ...o });
  assert.equal((await verifyRescue(answer({}))).ok, true);
  assert.equal((await verifyRescue(answer({ person_or_hand: true }))).ok, false);
  assert.equal((await verifyRescue(answer({ visible_brand_or_logo: true }))).ok, false);
  assert.equal((await verifyRescue(answer({ watermark: true }))).ok, false);
  const garbled = await verifyRescue(async () => 'not json');
  assert.equal(garbled.ok, false);
  assert.match(garbled.reason, /could not be checked/);
  assert.equal((await verifyRescue(async () => { throw new Error('down'); })).ok, false, 'a failed check is a refusal, never a pass');
});

// ---- the item list --------------------------------------------------------------------------------

test('the item list has at most four distinct products and never a person, a brand or a background', () => {
  const raw = JSON.stringify({ items: [{ name: 'Dropper bottle' }, { name: 'drinking glass' }, { name: 'hand holding a bottle' }, { name: 'brand logo' }, { name: 'dropper bottle' }, { name: 'linen cloth' }, { name: 'ceramic vase' }, { name: 'wooden spoon' }, { name: 'candle' }] });
  const items = parseItems(raw);
  assert.deepEqual(items, ['dropper bottle', 'drinking glass', 'ceramic vase', 'wooden spoon']);
  assert.equal(items.length, MAX_ITEMS);
  assert.deepEqual(parseItems('not json'), []);
  assert.deepEqual(parseItems(JSON.stringify({ items: 'x' })), []);
  assert.deepEqual(parseItems(JSON.stringify({ items: ['mug', 'mug', 'tall mug'] })), ['mug'], 'a name inside another name is the same item');
  assert.deepEqual(parseItems(JSON.stringify({ items: [{ name: 'a very long name for a product that goes on and on' }, { name: 'one two three four five' }] })), [], 'long names are dropped');
  assert.ok(!/[–—]/.test(parseItems(JSON.stringify({ items: [{ name: 'glass — clear' }] })).join()));
});

const found = (name, ok = true, reason = null) => ({ name, ok, reason, photo: ok ? 'data:image/jpeg;base64,xx' : null });

test('each found item becomes a row named "<item> (from <file>)"; ones that fail the check are listed as could not separate', () => {
  assert.equal(itemLabel('dropper bottle', 'busy-background.jpg'), 'dropper bottle (from busy-background.jpg)');
  const plan = planItemRows([found('dropper bottle'), found('drinking glass'), found('vase', false, 'the cut-out is cut off at the edge of the photo')], 5);
  assert.deepEqual(plan.add.map((a) => a.name), ['dropper bottle', 'drinking glass']);
  assert.deepEqual(plan.couldNotSeparate.map((a) => a.name), ['vase']);
  assert.equal(plan.noRoom.length, 0);
  const text = itemsSummary('busy-background.jpg', plan, 3);
  assert.match(text, /Found 3 items in busy-background\.jpg; 2 became rows: dropper bottle, drinking glass/);
  assert.match(text, /Could not separate: vase \(the cut-out is cut off at the edge of the photo\)/);
  assert.ok(!/[–—]/.test(text));
  assert.match(ITEMS_NOTE, /collection style catalogue/);
});

test('the catalogue never goes over 12 rows: the source photo is replaced by its items, and what does not fit is said', () => {
  assert.equal(MAX_ROWS, 12);
  const four = [found('a one'), found('b two'), found('c three'), found('d four')];
  assert.equal(planItemRows(four, 3).add.length, 4);
  assert.equal(planItemRows(four, 9).add.length, 4, '9 rows - 1 + 4 = 12');
  const full = planItemRows(four, 12);
  assert.equal(full.add.length, 1, 'with 12 rows, replacing the source leaves room for one');
  assert.deepEqual(full.noRoom.map((n) => n.name), ['b two', 'c three', 'd four']);
  assert.match(itemsSummary('x.jpg', full, 4), /No room for b two, c three, d four: a catalogue holds at most 12 rows/);
  assert.equal(planItemRows([found('a one', false, 'x')], 5).add.length, 0);
  assert.match(itemsSummary('x.jpg', planItemRows([found('a one', false, 'nothing found')], 5), 1), /No item in x\.jpg could be turned into a row\. Could not separate: a one \(nothing found\)\./);
});

// ---- the rescue path inside a run ----------------------------------------------------------------

const W = 800, H = 600;
const photo = await sharp({ create: { width: W, height: H, channels: 3, background: { r: 200, g: 200, b: 205 } } }).composite([{ input: await sharp({ create: { width: 260, height: 400, channels: 3, background: { r: 90, g: 90, b: 95 } } }).png().toBuffer(), left: 270, top: 100 }]).png().toBuffer();
const whole = await sharp({ create: { width: 260, height: 400, channels: 4, background: { r: 90, g: 90, b: 95, alpha: 1 } } }).png().toBuffer();
const half = await sharp({ create: { width: 260, height: 120, channels: 4, background: { r: 90, g: 90, b: 95, alpha: 1 } } }).png().toBuffer();
const state = { cut: null, fidelityCalls: 0 };

mock.module('../../src/lib/meta/client.ts', {
  namedExports: {
    MODELS: { text: 'muse-spark-1.3', image: 'muse-image-1.0', segment: 'sam-3.1' },
    meta: {
      responses: {
        create: async ({ input }) => {
          const prompt = input[0].content[0].text;
          if (prompt.includes('Look at this product photo')) return { output_text: JSON.stringify({ description: 'a steel flask', visible: ['steel'], printed_text: [] }) };
          if (prompt.includes('Image 1 is the real product')) { state.fidelityCalls++; return { output_text: JSON.stringify({ sameProduct: true, differences: [] }) }; }
          return { output_text: JSON.stringify({ score: 7, biggest_weakness: 'x', fix: 'y', text_in_image: [], product_halo: false, product_faded: false, awkward_crop: false, illegible_text: false, generic_or_ai_look: false }) };
        },
      },
    },
    text: async (input) => {
      if (input.includes('senior designer')) return JSON.stringify({ archetype: 'artwork', art_prompt: 'a scene', badge: [], cta: 'Shop now', pattern: 'grid', headline: 'Carry The Cold', subline: 'Steel that keeps up' });
      if (input.includes('Banned claims')) return JSON.stringify({ claims: [] });
      return '{}';
    },
    generateImage: async () => { throw new Error('no image'); },
    editImage: async () => { throw new Error('a rescue makes no scene'); },
    ImageBudget: class { async take() {} },
  },
});
mock.module('../../src/lib/meta/segment.ts', {
  namedExports: {
    cutOutProduct: async () => ({ png: state.cut.png, box: state.cut.box, matches: 1, method: 'concept', prompt: 'test', photoPng: photo }),
    locateInScene: async () => null,
  },
});
globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => photo.buffer.slice(photo.byteOffset, photo.byteOffset + photo.byteLength) });
console.info = () => {};
const { runCreativeLoop } = await import('../../src/lib/meta/loop.ts');
const brief = { briefType: 'product', clientName: 'Fernhill Home', productNoun: 'steel flask', productImageUrl: 'data:image/png;base64,ZmFrZQ==', audience: 'online shoppers', facts: 'A silver steel bottle', maxRounds: 2, rescue: true };

test('rescue: a cut-out that passes its check makes the ad on a studio or type-behind layout, never a scene, and the fidelity check runs', async () => {
  state.cut = { png: whole, box: { left: 270, top: 100, width: 260, height: 400 } };
  state.fidelityCalls = 0;
  const events = [];
  const result = await runCreativeLoop(brief, (e) => events.push(e));
  assert.ok(result.concepts.length >= 1);
  for (const c of result.concepts) assert.ok(['behind', 'product'].includes(c.archetype), `${c.archetype}: studio or type behind only`);
  assert.ok(state.fidelityCalls >= result.concepts.length, 'the fidelity check ran on every rescued ad');
  assert.ok(!events.some((e) => e.type === 'fallback_note' && /original photo is shown/.test(e.message)), 'no whole-photo fallback');
  for (const c of result.concepts) assert.equal(c.fidelity.sameProduct, true);
});

test('rescue: a cut-out that fails its check keeps the photo held back, with a plain message and no ad', async () => {
  state.cut = { png: half, box: { left: 270, top: 380, width: 260, height: 120 } }; // half the product, like the pilea
  const events = [];
  await assert.rejects(runCreativeLoop(brief, (e) => events.push(e)), (e) => e.message === RESCUE_NOT_SEPARATED);
  assert.equal(events.filter((e) => e.type === 'round_done').length, 0, 'no ad was made');
  assert.ok(events.some((e) => e.type === 'error' && e.message === RESCUE_NOT_SEPARATED));
  assert.match(RESCUE_NOT_SEPARATED, /stays held back/);
});

test('without rescue the same bad cut-out still falls back to the whole photo, as before', async () => {
  state.cut = { png: half, box: { left: 270, top: 380, width: 260, height: 120 } };
  const events = [];
  const result = await runCreativeLoop({ ...brief, rescue: undefined, maxRounds: 1 }, (e) => events.push(e));
  assert.equal(result.concepts.length, 1);
  assert.ok(events.some((e) => e.type === 'fallback_note' && /original photo is shown/.test(e.message)));
});
