// A cut-out that passes every count but has lost part of the product (a plant without its pot) switches to the whole-photo path, with a plain note.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

process.env.MODEL_API_KEY = 'test-fake-key';
import { COMPLETE_PROMPT, parseComplete, partialNote } from '../../src/lib/meta/cutoutSanity.ts';

const fixture = (n) => readFileSync(new URL(`./fixtures/${n}-cutout.png`, import.meta.url));

test('the completeness answer: only an explicit "not complete" counts, and the missing part is cleaned', () => {
  assert.deepEqual(parseComplete({ complete: true, missing: '' }), { complete: true, missing: '' });
  assert.deepEqual(parseComplete({ complete: false, missing: 'the pot' }), { complete: false, missing: 'the pot' });
  assert.deepEqual(parseComplete({ complete: false }), { complete: false, missing: 'part of it' });
  assert.deepEqual(parseComplete({ complete: false, missing: '<b>the pot</b>!!' }), { complete: false, missing: 'bthe potb' });
  for (const bad of [null, undefined, {}, 'x', { complete: 'no' }, { complete: 0 }]) assert.equal(parseComplete(bad).complete, true, JSON.stringify(bad));
  assert.match(COMPLETE_PROMPT, /a plant without its pot/);
  assert.equal(partialNote('the pot'), 'The cut-out lost part of the product (the pot), so the whole photo is used instead.');
});

const state = { answer: { complete: false, missing: 'the pot' }, throwOnCheck: false, checks: 0 };
const real = await import('../../src/lib/meta/cutoutSanity.ts');
mock.module('../../src/lib/meta/cutoutSanity.ts', { namedExports: { ...real, cutoutSanity: async () => ({ ok: true, failure: null, reason: null, coverage: 0.9, pieces: 1 }) } });
mock.module('../../src/lib/meta/client.ts', {
  namedExports: {
    MODELS: { text: 'muse-spark-1.3', image: 'muse-image-1.0', segment: 'sam-3.1' },
    meta: {
      responses: {
        create: async ({ input }) => {
          const prompt = input[0].content[0].text;
          if (prompt.includes('Is the whole product in the cut-out')) { state.checks++; if (state.throwOnCheck) throw new Error('down'); return { output_text: JSON.stringify(state.answer) }; }
          if (prompt.includes('Look at this product photo')) return { output_text: JSON.stringify({ description: 'a snake plant in a pot', visible: ['plant', 'pot'], printed_text: [] }) };
          if (prompt.includes('Image 1 is the real product')) return { output_text: JSON.stringify({ sameProduct: true, differences: [] }) };
          return { output_text: JSON.stringify({ score: 7, biggest_weakness: 'x', fix: 'y', text_in_image: [], product_halo: false, product_faded: false, awkward_crop: false, illegible_text: false, generic_or_ai_look: false }) };
        },
      },
    },
    text: async (input) => (input.includes('You write ad lines') ? JSON.stringify({ candidates: [{ angle: 'verb', headline: 'Grow Slowly', subline: 'Tall narrow leaves' }, { angle: 'moment', headline: 'Bring The Garden In', subline: 'Tall narrow leaves' }, { angle: 'benefit', headline: 'Green All Year', subline: 'A terracotta pot' }] }) : input.includes('senior designer') ? JSON.stringify({ archetype: 'behind', art_prompt: '', badge: [], cta: 'Shop now', pattern: 'grid', headline: 'x', subline: 'y' }) : '{}'),
    generateImage: async () => { throw new Error('no image'); },
    editImage: async () => { throw new Error('no image'); },
    ImageBudget: class { async take() {} },
  },
});
const photo = await sharp({ create: { width: 800, height: 800, channels: 3, background: '#eeeeee' } }).png().toBuffer();
mock.module('../../src/lib/meta/segment.ts', {
  namedExports: { cutOutProduct: async () => ({ png: fixture('plant-snake'), box: { left: 100, top: 50, width: 300, height: 600 }, matches: 1, method: 'concept', prompt: 'test', photoPng: photo }), locateInScene: async () => null },
});
globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(10) });
console.info = () => {};
const { runCreativeLoop } = await import('../../src/lib/meta/loop.ts');
const brief = { briefType: 'product', clientName: 'Fernhill Home', productNoun: 'snake plant', productImageUrl: 'data:image/png;base64,ZmFrZQ==', audience: 'online shoppers', facts: 'A plant with tall, narrow, striped green leaves in a terracotta-coloured pot', maxRounds: 1 };

test('a cut-out that lost the pot goes to the whole-photo path, and the card says so in plain words', async () => {
  state.answer = { complete: false, missing: 'the pot' };
  const events = [];
  const r = await runCreativeLoop(brief, (e) => events.push(e));
  assert.ok(events.some((e) => e.type === 'fallback_note' && e.message === 'The cut-out lost part of the product (the pot), so the whole photo is used instead.'), JSON.stringify(events.filter((e) => e.type === 'fallback_note')));
  assert.ok(r.concepts.length >= 1);
  assert.notEqual(r.concepts[0].archetype, 'behind', 'type behind a cut-out is not used for a whole photo');
  assert.equal(r.concepts[0].style.effectable, false, 'a whole photo takes no effects');
});

test('a complete cut-out is kept, and a check that cannot run never blocks it', async () => {
  state.answer = { complete: true, missing: '' };
  let events = [];
  await runCreativeLoop(brief, (e) => events.push(e));
  assert.ok(!events.some((e) => e.type === 'fallback_note' && /lost part/.test(e.message)));
  state.throwOnCheck = true;
  events = [];
  await runCreativeLoop(brief, (e) => events.push(e));
  state.throwOnCheck = false;
  assert.ok(!events.some((e) => e.type === 'fallback_note' && /lost part/.test(e.message)));
});

test('a rescued photo whose cut-out lost part of the product stays held back', async () => {
  state.answer = { complete: false, missing: 'the pot' };
  await assert.rejects(runCreativeLoop({ ...brief, rescue: true }, () => {}), /could not be separated/);
});
